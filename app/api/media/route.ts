import { NextResponse } from "next/server";
import { fetchChunk } from "../../../lib/media";
import { pickVariant, resolvePost } from "../../../lib/tweet";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Stay comfortably under Vercel's 4.5 MB response payload cap. */
const MAX_CHUNK = 4_000_000;

/**
 * Serves `len` bytes of a post's video starting at `start`.
 *
 * A whole video is far larger than a Vercel Function may return in one response, so the
 * browser pulls it in chunks and assembles the file client-side.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";

  if (!/^\d{5,25}$/.test(id)) {
    return NextResponse.json({ error: "Invalid post id." }, { status: 400 });
  }

  const post = await resolvePost(id);
  if (!post) {
    return NextResponse.json({ error: "Could not read that post." }, { status: 404 });
  }

  const videoIndex = Number(params.get("v") ?? 0) || 0;
  const qualityIndex = Number(params.get("q") ?? 0) || 0;
  const picked = pickVariant(post, videoIndex, qualityIndex);
  if (!picked) {
    return NextResponse.json({ error: "That video is no longer available." }, { status: 404 });
  }

  const start = Math.max(0, Number(params.get("start") ?? 0) || 0);
  const len = Math.min(MAX_CHUNK, Math.max(1, Number(params.get("len") ?? MAX_CHUNK) || MAX_CHUNK));

  const chunk = await fetchChunk(picked.variant.url, start, len);
  if (!chunk.ok) {
    return NextResponse.json({ error: chunk.error }, { status: chunk.status });
  }

  const headers = new Headers({
    "content-type": chunk.contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=0, must-revalidate",
  });

  if (chunk.totalSize) {
    headers.set("x-total-size", String(chunk.totalSize));
    headers.set(
      "content-range",
      `bytes ${start}-${Math.min(start + len - 1, chunk.totalSize - 1)}/${chunk.totalSize}`,
    );
  }

  return new Response(chunk.body, { status: 200, headers });
}
