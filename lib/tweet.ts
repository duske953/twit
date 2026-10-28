/**
 * Turns an X/Twitter post into a list of downloadable video variants.
 *
 * Two independent public sources are supported, both keyless:
 *  1. cdn.syndication.twimg.com/tweet-result — the endpoint that powers official
 *     embedded posts. Richest data, no third party involved.
 *  2. api.fxtwitter.com — community mirror, used when (1) is rate limited.
 *
 * Everything is resolved from a post ID we parsed ourselves, so no user supplied
 * URL is ever fetched directly (no open proxy).
 */

export type Source = "syndication" | "fxtwitter";

export interface Variant {
  url: string;
  /** e.g. "1080p" */
  label: string;
  height?: number;
  width?: number;
  bitrate?: number;
}

export interface Video {
  kind: "video" | "gif";
  poster?: string;
  durationMs?: number;
  variants: Variant[];
}

export interface Post {
  id: string;
  author: string;
  authorName: string;
  text: string;
  createdAt?: string;
  videos: Video[];
  source: Source;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

/** Embeds derive this token from the snowflake ID with a fixed formula. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

/**
 * Accepts a full URL, a scheme-less URL, a share URL with a ?s=20 suffix, an
 * /i/web/status/ link, a /video/1 link, or a bare numeric ID.
 */
export function extractPostId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (/^\d{5,25}$/.test(raw)) return raw;

  const match = raw.match(/(?:^|\/)(?:status|statuses)\/(\d{5,25})(?![\d])/i);
  if (match) return match[1];

  // x.com/i/web/status/<id> and other shapes where "status" is not preceded by /
  const loose = raw.match(/\bstatus\w*\D{0,3}(\d{5,25})(?![\d])/i);
  if (loose) return loose[1];

  return null;
}

function sizeLabel(url: string, bitrate?: number, height?: number): string {
  const fromUrl = url.match(/\/(\d+)x(\d+)\//);
  if (fromUrl) return `${fromUrl[2]}p`;
  if (height) return `${height}p`;
  if (bitrate) return `${Math.round(bitrate / 1000)} kbps`;
  return "video";
}

function dedupeSort(variants: Variant[]): Variant[] {
  const seen = new Set<string>();
  const out: Variant[] = [];
  for (const v of variants) {
    const key = v.url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => {
    const byHeight = (b.height ?? 0) - (a.height ?? 0);
    if (byHeight !== 0) return byHeight;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });
}

function isPlayable(url: string): boolean {
  return !/\.m3u8(\?|$)/i.test(url);
}

/* ------------------------------------------------------------------ *
 * syndication
 * ------------------------------------------------------------------ */

interface AnyRec {
  [key: string]: unknown;
}

export function normalizeSyndication(data: AnyRec): Post | null {
  const id = String(data.id_str ?? "");
  if (!id) return null;

  const user = (data.user ?? {}) as AnyRec;
  const videos: Video[] = [];

  // Preferred: mediaDetails[].video_info.variants (these carry bitrates).
  const details = Array.isArray(data.mediaDetails) ? (data.mediaDetails as AnyRec[]) : [];
  for (const item of details) {
    const type = String(item.type ?? "");
    const info = (item.video_info ?? {}) as AnyRec;
    const rawVariants = Array.isArray(info.variants) ? (info.variants as AnyRec[]) : [];
    const variants: Variant[] = rawVariants
      .filter((v) => /video\/mp4/i.test(String(v.content_type ?? "")))
      .filter((v) => isPlayable(String(v.url ?? "")))
      .map((v) => ({
        url: String(v.url),
        bitrate: typeof v.bitrate === "number" ? v.bitrate : undefined,
        label: sizeLabel(String(v.url), typeof v.bitrate === "number" ? v.bitrate : undefined),
      }));

    if (variants.length > 0) {
      videos.push({
        kind: type === "animated_gif" ? "gif" : "video",
        poster: typeof item.media_url_https === "string" ? item.media_url_https : undefined,
        durationMs: typeof info.duration_millis === "number" ? info.duration_millis : undefined,
        variants: dedupeSort(variants),
      });
    }
  }

  // Fallback: the flattened top-level `video` object (no bitrates).
  if (videos.length === 0) {
    const video = (data.video ?? {}) as AnyRec;
    const rawVariants = Array.isArray(video.variants) ? (video.variants as AnyRec[]) : [];
    const variants: Variant[] = rawVariants
      .filter((v) => /video\/mp4/i.test(String(v.type ?? "")))
      .filter((v) => isPlayable(String(v.src ?? "")))
      .map((v) => ({
        url: String(v.src),
        label: sizeLabel(String(v.src)),
      }));

    if (variants.length > 0) {
      videos.push({
        kind: "video",
        poster: typeof video.poster === "string" ? video.poster : undefined,
        durationMs: typeof video.durationMs === "number" ? video.durationMs : undefined,
        variants: dedupeSort(variants),
      });
    }
  }

  if (videos.length === 0) return null;

  return {
    id,
    author: String(user.screen_name ?? "unknown"),
    authorName: String(user.name ?? ""),
    text: String(data.text ?? ""),
    createdAt: typeof data.created_at === "string" ? data.created_at : undefined,
    videos,
    source: "syndication",
  };
}

/* ------------------------------------------------------------------ *
 * fxtwitter
 * ------------------------------------------------------------------ */

export function normalizeFxtwitter(payload: AnyRec): Post | null {
  const tweet = (payload.tweet ?? {}) as AnyRec;
  const id = String(tweet.id ?? "");
  if (!id) return null;

  const author = (tweet.author ?? {}) as AnyRec;
  const media = (tweet.media ?? {}) as AnyRec;
  const rawVideos = Array.isArray(media.videos) ? (media.videos as AnyRec[]) : [];

  const videos: Video[] = [];
  for (const item of rawVideos) {
    const rawFormats = Array.isArray(item.formats) ? (item.formats as AnyRec[]) : [];
    let variants: Variant[] = rawFormats
      .filter((f) => String(f.container ?? "").toLowerCase() === "mp4")
      .filter((f) => isPlayable(String(f.url ?? "")))
      .map((f) => ({
        url: String(f.url),
        bitrate: typeof f.bitrate === "number" ? f.bitrate : undefined,
        label: sizeLabel(String(f.url), typeof f.bitrate === "number" ? f.bitrate : undefined),
      }));

    if (variants.length === 0 && typeof item.url === "string") {
      variants = [{ url: item.url, label: sizeLabel(item.url) }];
    }

    if (variants.length > 0) {
      videos.push({
        kind: String(item.type ?? "") === "gif" ? "gif" : "video",
        poster: typeof item.thumbnail_url === "string" ? item.thumbnail_url : undefined,
        durationMs:
          typeof item.duration === "number" ? Math.round(item.duration * 1000) : undefined,
        variants: dedupeSort(variants),
      });
    }
  }

  if (videos.length === 0) return null;

  return {
    id,
    author: String(author.screen_name ?? "unknown"),
    authorName: String(author.name ?? ""),
    text: String(tweet.text ?? ""),
    createdAt: typeof tweet.created_at === "string" ? tweet.created_at : undefined,
    videos,
    source: "fxtwitter",
  };
}

/* ------------------------------------------------------------------ *
 * fetching
 * ------------------------------------------------------------------ */

async function getJson(url: string): Promise<AnyRec | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as AnyRec;
  } catch {
    return null;
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; post: Post | null }>();

export async function resolvePost(id: string): Promise<Post | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.post;

  const token = syndicationToken(id);
  const syndicated = await getJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`,
  );
  let post = syndicated ? normalizeSyndication(syndicated) : null;

  if (!post) {
    const fx = await getJson(`https://api.fxtwitter.com/status/${id}`);
    post = fx ? normalizeFxtwitter(fx) : null;
  }

  if (cache.size > 100) cache.clear();
  cache.set(id, { at: Date.now(), post });
  return post;
}

/**
 * Diagnostic: does THIS server reach the media host, and what does it answer?
 * Used by /api/check to tell a network block apart from a CDN rejection.
 */
export async function probeMedia(url: string): Promise<{
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  error?: string;
}> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": UA, referer: "https://x.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
    };
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    return { error: code ?? (error as Error).name };
  }
}

export function fileNameFor(post: Post, variant: Variant, index: number): string {
  const author = post.author.replace(/[^\w.-]+/g, "_") || "post";
  const suffix = post.videos.length > 1 ? `-${index + 1}` : "";
  return `${author}-${post.id}${suffix}-${variant.label.replace(/\s+/g, "")}.mp4`;
}
