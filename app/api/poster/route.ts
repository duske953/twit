import { NextResponse } from "next/server";
import { pickVariant, resolvePost } from "../../../lib/tweet";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

/** Thumbnails are small enough to relay whole through a Function. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";

  if (!/^\d{5,25}$/.test(id)) {
    return NextResponse.json({ error: "Invalid post id." }, { status: 400 });
  }

  const post = await resolvePost(id);
  const picked = post && pickVariant(post, Number(params.get("v") ?? 0) || 0, 0);
  const poster = picked?.video.poster;
  if (!poster) {
    return NextResponse.json({ error: "No poster for that post." }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(poster, {
      headers: { "user-agent": UA, referer: "https://x.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach X." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Thumbnail unavailable." }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=3600",
    },
  });
}
