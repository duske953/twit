import { test } from "node:test";
import assert from "node:assert/strict";

import { limitStream, readAll } from "../lib/stream.ts";

/** 0..99 in small uneven slices, so chunk boundaries land mid-window. */
function source(sizes = [3, 1, 7, 20, 40, 29]) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const data = Uint8Array.from({ length: total }, (_, i) => i);
  let offset = 0;
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= total) {
        controller.close();
        return;
      }
      const size = index < sizes.length ? sizes[index] : 10;
      controller.enqueue(data.slice(offset, offset + size));
      offset += size;
      index += 1;
    },
  });
}

const asString = (bytes) => Array.from(bytes).join(",");

test("skips and takes across chunk boundaries", async () => {
  const out = await readAll(limitStream(source(), 3, 4));
  assert.equal(asString(out), "3,4,5,6");
});

test("a window that starts mid-chunk is exact", async () => {
  const out = await readAll(limitStream(source(), 5, 10));
  assert.equal(asString(out), "5,6,7,8,9,10,11,12,13,14");
});

test("zero skip returns from the very first byte", async () => {
  const out = await readAll(limitStream(source(), 0, 5));
  assert.equal(asString(out), "0,1,2,3,4");
});

test("take beyond the end yields only what exists", async () => {
  const total = 100;
  const out = await readAll(limitStream(source(), 90, 4_000_000));
  assert.equal(out.byteLength, total - 90);
  assert.equal(out[0], 90);
});

test("skip beyond the end yields nothing", async () => {
  const out = await readAll(limitStream(source(), 500, 100));
  assert.equal(out.byteLength, 0);
});

test("never exceeds the requested window", async () => {
  for (const skip of [0, 1, 17, 64]) {
    const out = await readAll(limitStream(source(), skip, 25));
    assert.equal(out.byteLength, 25, `skip=${skip}`);
    assert.equal(out[0], skip, `skip=${skip} first byte`);
  }
});
