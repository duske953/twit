"use client";

import { useState } from "react";

interface Variant {
  url: string;
  label: string;
  height?: number;
  bitrate?: number;
}

interface Video {
  kind: "video" | "gif";
  poster?: string;
  durationMs?: number;
  variants: Variant[];
}

interface Post {
  id: string;
  author: string;
  authorName: string;
  text: string;
  createdAt?: string;
  videos: Video[];
}

/** Must match MAX_CHUNK in /api/media — keeps each response under Vercel's payload cap. */
const CHUNK = 4_000_000;
const MAX_CHUNKS = 500;

/** Preview only: twimg path served by the /m/ rewrite. */
function viaOwnHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `/m${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function fileName(post: Post, videoIndex: number, variant: Variant): string {
  const who = post.author.replace(/[^\w.-]+/g, "_") || "post";
  const multi = post.videos.length > 1 ? `-${videoIndex + 1}` : "";
  return `${who}-${post.id}${multi}-${variant.label.replace(/\s+/g, "")}.mp4`;
}

function duration(ms?: number): string | null {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export default function Page() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [progress, setProgress] = useState<{ key: string; got: number; total?: number } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setPost(null);
    setPicked({});

    try {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(input)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
      } else {
        setPost(data.post);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pulls the video in bounded chunks and assembles it in the browser. A single response
   * cannot exceed Vercel's 4.5 MB payload cap, so large videos are fetched piece by piece.
   */
  async function download(
    post: Post,
    videoIndex: number,
    qualityIndex: number,
    variant: Variant,
  ) {
    const key = `${post.id}-${videoIndex}`;
    if (progress) return;

    setError(null);
    setProgress({ key, got: 0 });

    const parts: BlobPart[] = [];
    let start = 0;
    let total: number | undefined;

    try {
      for (let attempt = 0; attempt < MAX_CHUNKS; attempt++) {
        const res = await fetch(
          `/api/media?id=${post.id}&v=${videoIndex}&q=${qualityIndex}&start=${start}&len=${CHUNK}`,
        );

        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? `The server returned HTTP ${res.status}.`);
        }

        const sizeHeader = Number(res.headers.get("x-total-size") ?? 0);
        if (sizeHeader > 0) total = sizeHeader;

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength === 0) break;

        parts.push(buffer);
        start += buffer.byteLength;
        setProgress({ key, got: start, total });

        if (total && start >= total) break;
        if (buffer.byteLength < CHUNK) break;
      }

      if (parts.length === 0) throw new Error("The server returned no data.");

      const blob = new Blob(parts, { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName(post, videoIndex, variant);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} If this keeps happening, try a lower quality.`
          : "Download failed.",
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <main className="wrap">
      <h1>Post video downloader</h1>
      <p className="sub">
        Paste an X or Twitter post link. The video is fetched by this server and streamed to you
        from this domain, so it still works when video.twimg.com is blocked on your network.
      </p>

      <form onSubmit={submit}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://x.com/user/status/1234567890"
          autoComplete="off"
          spellCheck={false}
          aria-label="Post link"
        />
        <button type="submit" disabled={loading || input.trim() === ""}>
          {loading ? "Checking…" : "Get video"}
        </button>
      </form>
      <p className="hint">Share links with ?s=20 or a bare post ID work too.</p>

      {error && <div className="error">{error}</div>}

      {post?.videos.map((video, videoIndex) => {
        const choice = picked[videoIndex] ?? 0;
        const variant = video.variants[choice] ?? video.variants[0];
        const length = duration(video.durationMs);
        const key = `${post.id}-${videoIndex}`;
        const busy = progress?.key === key;
        const pct =
          busy && progress?.total
            ? Math.min(100, Math.round((progress.got / progress.total) * 100))
            : null;

        return (
          <article className="card" key={key}>
            <header className="card-head">
              <span className="author">{post.authorName || post.author}</span>
              <span className="handle">@{post.author}</span>
              <span className="origin">{video.kind === "gif" ? "GIF" : "Video"}</span>
            </header>

            {post.text.trim() !== "" && <div className="body">{post.text}</div>}

            <div className="media">
              <video
                controls
                playsInline
                preload="metadata"
                poster={`/api/poster?id=${post.id}&v=${videoIndex}`}
                src={viaOwnHost(variant.url)}
              />

              <div className="row">
                {video.variants.length > 1 && (
                  <select
                    value={choice}
                    disabled={busy}
                    aria-label="Quality"
                    onChange={(e) =>
                      setPicked((prev) => ({ ...prev, [videoIndex]: Number(e.target.value) }))
                    }
                  >
                    {video.variants.map((v, index) => (
                      <option key={v.url} value={index}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  className="download"
                  disabled={busy}
                  onClick={() => download(post, videoIndex, choice, variant)}
                >
                  {busy
                    ? progress?.total
                      ? `Downloading ${mb(progress.got)} / ${mb(progress.total)}`
                      : `Downloading ${mb(progress.got)}…`
                    : `Download ${variant.label} MP4`}
                </button>
              </div>

              {busy && (
                <div className="bar" aria-hidden>
                  <span style={{ width: pct === null ? "100%" : `${pct}%` }} />
                </div>
              )}

              <div className="row">
                {length && <span className="meta">{length}</span>}
                <span className="meta">assembled in your browser</span>
                <a
                  className="orig"
                  href={`https://x.com/i/status/${post.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View post ↗
                </a>
              </div>
            </div>
          </article>
        );
      })}

      <p className="foot">
        Public posts only. Bytes stream from X through this deployment — nothing is stored.
        Keep to content you have the right to download.
      </p>
    </main>
  );
}
