import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchChunk } from "../lib/media.ts";
import { readAll } from "../lib/stream.ts";

const DATA = Uint8Array.from({ length: 100 }, (_, i) => i);
const VIDEO_URL = "https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/x.mp4";

function streamOf(bytes = DATA) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + 7));
      offset += 7;
    },
  });
}

/** Swap global fetch for the duration of `run`. */
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("honours a 206 and reports the total size", async () => {
  await withFetch(
    async () =>
      new Response(streamOf(DATA.slice(15, 35)), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 15-34/100",
        },
      }),
    async () => {
      const chunk = await fetchChunk(VIDEO_URL, 15, 20);
      assert.equal(chunk.ok, true);
      assert.equal(chunk.ranged, true);
      assert.equal(chunk.totalSize, 100);
      assert.equal(chunk.contentType, "video/mp4");

      const bytes = await readAll(chunk.body);
      assert.equal(bytes.byteLength, 20);
      assert.equal(bytes[0], 15);
      assert.equal(bytes[19], 34);
    },
  );
});

test("a CDN that ignores Range still yields exactly the requested window", async () => {
  // X returns the whole file with a plain 200 in this scenario.
  await withFetch(
    async () =>
      new Response(streamOf(DATA), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "100" },
      }),
    async () => {
      const chunk = await fetchChunk(VIDEO_URL, 40, 25);
      assert.equal(chunk.ok, true);
      assert.equal(chunk.ranged, false);
      assert.equal(chunk.totalSize, 100);

      const bytes = await readAll(chunk.body);
      assert.equal(bytes.byteLength, 25, "must be capped at len");
      assert.equal(bytes[0], 40, "must start at the requested offset");
      assert.equal(bytes[24], 64);
    },
  );
});

test("sends the Range header it promises", async () => {
  let seen = "";
  await withFetch(
    async (url, init) => {
      seen = init?.headers?.range ?? "";
      return new Response(streamOf(DATA.slice(0, 10)), {
        status: 206,
        headers: { "content-range": "bytes 0-9/100" },
      });
    },
    async () => {
      await fetchChunk(VIDEO_URL, 0, 10);
    },
  );
  assert.equal(seen, "bytes=0-9");
});

test("reports a refused upstream instead of throwing", async () => {
  await withFetch(
    async () => new Response("denied", { status: 403 }),
    async () => {
      const chunk = await fetchChunk(VIDEO_URL, 0, 10);
      assert.equal(chunk.ok, false);
      assert.equal(chunk.status, 502);
      assert.match(chunk.error, /403/);
    },
  );
});

test("reports a network failure with its socket code", async () => {
  await withFetch(
    async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNRESET" };
      throw error;
    },
    async () => {
      const chunk = await fetchChunk(VIDEO_URL, 0, 10);
      assert.equal(chunk.ok, false);
      assert.match(chunk.error, /ECONNRESET/);
    },
  );
});
