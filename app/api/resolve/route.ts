import { NextResponse } from "next/server";
import { extractPostId, resolvePost } from "../../../lib/tweet";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url") ?? "";
  const id = extractPostId(input);

  if (!id) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That doesn't look like a post link. Paste something like https://x.com/user/status/1234567890 — or just the post ID.",
      },
      { status: 400 },
    );
  }

  const post = await resolvePost(id);

  if (!post) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No downloadable video found for that post. It may have no video, be private/deleted, or the public endpoints may be rate limiting right now.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, post });
}
