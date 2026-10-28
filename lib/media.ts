import { limitStream } from "./stream.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

export interface ChunkOk {
  ok: true;
  body: ReadableStream<Uint8Array>;
  contentType: string;
  /** Full size of the video, when the CDN tells us. */
  totalSize?: number;
  /** True when the CDN honoured the Range header (206). */
  ranged: boolean;
}

export interface ChunkFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Fetches `len` bytes of `url` starting at `start`.
 *
 * Whether or not the CDN honours the Range request, the returned stream yields at most
 * `len` bytes, so the caller's response cannot exceed Vercel's payload cap.
 */
export async function fetchChunk(
  url: string,
  start: number,
  len: number,
): Promise<ChunkOk | ChunkFailure> {
  const end = start + len - 1;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "user-agent": UA,
        referer: "https://x.com/",
        range: `bytes=${start}-${end}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    return {
      ok: false,
      status: 502,
      error: `Could not reach X's media host (${code ?? "network error"}).`,
    };
  }

  if (!upstream.ok || !upstream.body) {
    return {
      ok: false,
      status: 502,
      error: `X's media host refused the request (HTTP ${upstream.status}).`,
    };
  }

  const ranged = upstream.status === 206;
  let totalSize: number | undefined;

  const rangeMatch = upstream.headers.get("content-range")?.match(/bytes\s+\d+-\d+\/(\d+|\*)/i);
  if (rangeMatch && rangeMatch[1] !== "*") {
    totalSize = Number(rangeMatch[1]);
  } else if (!ranged) {
    const length = Number(upstream.headers.get("content-length") ?? 0);
    if (length > 0) totalSize = length;
  }

  return {
    ok: true,
    body: limitStream(upstream.body, ranged ? 0 : start, len),
    contentType: upstream.headers.get("content-type") ?? "video/mp4",
    totalSize,
    ranged,
  };
}
