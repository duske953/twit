import { NextResponse } from "next/server";
import { extractPostId, probeMedia, resolvePost } from "../../../lib/tweet";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Diagnostics for a failed download. Open /api/check?url=<post link> in a browser:
 *
 *  - metadata ok + probe ok        -> the server can fetch the video; the problem is elsewhere
 *  - metadata ok + probe ECONNRESET/ENOTFOUND -> this server's network blocks video.twimg.com
 *    (running locally on a blocked connection? deploy it, the deployed host is the one that
 *    does the fetching)
 *  - metadata ok + probe 403/404   -> X's CDN is refusing this server (datacenter IP / bad tag)
 */
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url") ?? "";
  const id = extractPostId(input);

  if (!id) {
    return NextResponse.json(
      { ok: false, step: "parse", error: "Not a post link. Pass ?url=<link>." },
      { status: 400 },
    );
  }

  const post = await resolvePost(id);
  if (!post) {
    return NextResponse.json(
      {
        ok: false,
        step: "metadata",
        error: "Could not read metadata from syndication or fxtwitter.",
      },
      { status: 404 },
    );
  }

  const probes = await Promise.all(
    post.videos.map(async (video, index) => {
      const variant = video.variants[0];
      return {
        video: index + 1,
        quality: variant.label,
        url: variant.url,
        ...(await probeMedia(variant.url)),
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    id: post.id,
    author: post.author,
    metadataSource: post.source,
    videos: probes,
  });
}
