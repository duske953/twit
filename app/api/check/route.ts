import { NextResponse } from "next/server";
import { explainFailure, extractPostId, inspectPost, probeMedia } from "../../../lib/tweet";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Diagnostics for a failed download. Open /api/check?url=<post link> in a browser.
 *
 * `attempts` shows what each metadata source answered, which separates the cases that
 * otherwise look identical:
 *   status 429            -> X is throttling this deployment's IP
 *   status 403 / 404      -> post missing/private, or the source refuses this server
 *   error ECONNRESET      -> this deployment's network cannot reach X
 *   note "no video"       -> the post simply has no video
 * `media` then HEAD-probes the chosen MP4, i.e. whether the download itself could work.
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

  const { post, attempts } = await inspectPost(id);

  if (!post) {
    return NextResponse.json(
      { ok: false, step: "metadata", id, error: explainFailure(attempts), attempts },
      { status: 404 },
    );
  }

  const media = await Promise.all(
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
    attempts,
    media,
  });
}
