import { test } from "node:test";
import assert from "node:assert/strict";

import {
  explainFailure,
  extractPostId,
  normalizeFxtwitter,
  normalizeSyndication,
  syndicationToken,
} from "../lib/tweet.ts";

// Shapes below are trimmed from real responses (SpaceX post 1977878290489643190).

const syndicationFixture = {
  __typename: "Tweet",
  id_str: "1977878290489643190",
  text: "Liftoff of Starship! https://t.co/sbfmGAEPa6",
  created_at: "2025-10-13T23:25:06.000Z",
  user: { name: "SpaceX", screen_name: "SpaceX" },
  mediaDetails: [
    {
      type: "video",
      media_url_https:
        "https://pbs.twimg.com/amplify_video_thumb/1977878189088309248/img/vTduZ64mhY4cRWI5.jpg",
      video_info: {
        duration_millis: 43110,
        variants: [
          {
            content_type: "application/x-mpegURL",
            url: "https://video.twimg.com/amplify_video/1977878189088309248/pl/Gy55E_GM2gLq1U5i.m3u8?v=42f",
          },
          {
            bitrate: 256000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/480x270/vVXbvzKMfaXS6M-Y.mp4",
          },
          {
            bitrate: 2176000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/1280x720/PrCY_7-6Qley8Sen.mp4",
          },
          {
            bitrate: 25128000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/3840x2160/QTBhIjOHT-cBDeUQ.mp4",
          },
        ],
      },
    },
  ],
  video: {
    poster:
      "https://pbs.twimg.com/amplify_video_thumb/1977878189088309248/img/vTduZ64mhY4cRWI5.jpg",
    durationMs: 43110,
    variants: [
      {
        type: "application/x-mpegURL",
        src: "https://video.twimg.com/amplify_video/1977878189088309248/pl/Gy55E_GM2gLq1U5i.m3u8?v=42f",
      },
      {
        type: "video/mp4",
        src: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/480x270/vVXbvzKMfaXS6M-Y.mp4",
      },
    ],
  },
};

const fxFixture = {
  code: 200,
  message: "OK",
  tweet: {
    id: "1977878290489643190",
    text: "Liftoff of Starship!",
    created_at: "Mon Oct 13 23:25:06 +0000 2025",
    author: { screen_name: "SpaceX", name: "SpaceX" },
    media: {
      videos: [
        {
          id: "1977878189088309248",
          type: "video",
          url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/3840x2160/QTBhIjOHT-cBDeUQ.mp4?tag=21",
          thumbnail_url:
            "https://pbs.twimg.com/amplify_video_thumb/1977878189088309248/img/vTduZ64mhY4cRWI5.jpg",
          duration: 43.11,
          format: "video/mp4",
          formats: [
            {
              url: "https://video.twimg.com/amplify_video/1977878189088309248/pl/Gy55E_GM2gLq1U5i.m3u8?tag=21&v=42f",
              container: "m3u8",
            },
            {
              url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/640x360/E9FQWPtzIlKPgqWl.mp4?tag=21",
              bitrate: 832000,
              container: "mp4",
              codec: "h264",
            },
            {
              url: "https://video.twimg.com/amplify_video/1977878189088309248/vid/avc1/1920x1080/aJF7NFohx3C8JJdu.mp4?tag=21",
              bitrate: 10368000,
              container: "mp4",
              codec: "h264",
            },
          ],
        },
      ],
    },
  },
};

test("parses post IDs out of every link shape people actually paste", () => {
  const id = "1977878290489643190";
  const cases = [
    `https://x.com/SpaceX/status/${id}`,
    `https://x.com/SpaceX/status/${id}?s=20&t=abc`,
    `https://www.twitter.com/SpaceX/status/${id}`,
    `https://mobile.twitter.com/i/web/status/${id}`,
    `https://x.com/SpaceX/status/${id}/video/1`,
    `x.com/SpaceX/status/${id}`,
    `  https://x.com/SpaceX/status/${id}  `,
    id,
  ];

  for (const input of cases) {
    assert.equal(extractPostId(input), id, `failed for: ${input}`);
  }
});

test("rejects things that are not post links", () => {
  for (const input of ["", "   ", "https://x.com/SpaceX", "hello world", "https://example.com/status/abc"]) {
    assert.equal(extractPostId(input), null, `should not parse: ${input}`);
  }
});

test("derives the embed token the same way X's widgets do", () => {
  assert.equal(syndicationToken("20"), "6dq1a2xwd93");
});

test("normalizes syndication media, dropping HLS and sorting best-first", () => {
  const post = normalizeSyndication(syndicationFixture);
  assert.ok(post);
  assert.equal(post.id, "1977878290489643190");
  assert.equal(post.author, "SpaceX");
  assert.equal(post.source, "syndication");
  assert.equal(post.videos.length, 1);

  const video = post.videos[0];
  assert.equal(video.kind, "video");
  assert.equal(video.durationMs, 43110);
  assert.match(video.poster, /pbs\.twimg\.com/);

  // m3u8 filtered out, and the richest variant comes first.
  assert.equal(video.variants.length, 3);
  assert.deepEqual(
    video.variants.map((v) => v.label),
    ["2160p", "720p", "270p"],
  );
  assert.equal(video.variants[0].bitrate, 25128000);
  assert.ok(video.variants.every((v) => v.url.includes(".mp4")));
});

test("falls back to the flat video object when mediaDetails is absent", () => {
  const post = normalizeSyndication({
    id_str: "123456789",
    text: "hi",
    user: { screen_name: "someone", name: "Someone" },
    video: {
      poster: "https://pbs.twimg.com/x.jpg",
      durationMs: 9000,
      variants: [
        { type: "application/x-mpegURL", src: "https://video.twimg.com/x.m3u8" },
        { type: "video/mp4", src: "https://video.twimg.com/vid/avc1/640x360/a.mp4" },
      ],
    },
  });

  assert.ok(post);
  assert.equal(post.videos[0].variants.length, 1);
  assert.equal(post.videos[0].variants[0].label, "360p");
});

test("normalizes the fxtwitter fallback", () => {
  const post = normalizeFxtwitter(fxFixture);
  assert.ok(post);
  assert.equal(post.source, "fxtwitter");
  assert.equal(post.author, "SpaceX");
  assert.equal(post.videos[0].durationMs, 43110);
  assert.deepEqual(
    post.videos[0].variants.map((v) => v.label),
    ["1080p", "360p"],
  );
});

test("explains each failure mode distinctly", () => {
  const noVideo = [
    { source: "syndication", status: 200, found: false, videos: 0, note: "answered, but the post has no video" },
  ];
  assert.match(explainFailure(noVideo), /doesn't contain a video/);

  const throttled = [
    { source: "syndication", status: 429, found: false, videos: 0 },
    { source: "fxtwitter", status: 429, found: false, videos: 0 },
  ];
  assert.match(explainFailure(throttled), /rate limiting/);

  const missing = [
    { source: "syndication", status: 404, found: false, videos: 0 },
    { source: "fxtwitter", status: 404, found: false, videos: 0 },
  ];
  assert.match(explainFailure(missing), /not found/);

  const unreachable = [
    { source: "syndication", error: "ECONNRESET", found: false, videos: 0 },
    { source: "fxtwitter", error: "ENOTFOUND", found: false, videos: 0 },
  ];
  assert.match(explainFailure(unreachable), /could not reach X/);
  assert.match(explainFailure(unreachable), /ECONNRESET/);
});

test("returns null when a post carries no video", () => {
  assert.equal(
    normalizeSyndication({ id_str: "20", text: "just setting up my twttr", user: {} }),
    null,
  );
  assert.equal(normalizeFxtwitter({ tweet: { id: "20", text: "no media" } }), null);
});
