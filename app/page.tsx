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

/** Point a twimg URL at our own origin, where the rewrite proxy serves it. */
function viaOwnHost(url: string, prefix: "/m" | "/p"): string {
  try {
    const parsed = new URL(url);
    return `${prefix}${parsed.pathname}${parsed.search}`;
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

export default function Page() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});

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
      <p className="hint">Short links, share links with ?s=20, or a bare post ID all work.</p>

      {error && <div className="error">{error}</div>}

      {post?.videos.map((video, videoIndex) => {
        const choice = picked[videoIndex] ?? 0;
        const variant = video.variants[choice] ?? video.variants[0];
        const length = duration(video.durationMs);

        return (
          <article className="card" key={`${post.id}-${videoIndex}`}>
            <header className="card-head">
              <span className="author">{post.authorName || post.author}</span>
              <span className="handle">@{post.author}</span>
              <span className="origin">{video.kind === "gif" ? "GIF" : "Video"}</span>
            </header>

            {post.text.trim() !== "" && <div className="body">{post.text}</div>}

            <div className="media">
              <video
                key={variant.url}
                controls
                playsInline
                preload="metadata"
                poster={video.poster ? viaOwnHost(video.poster, "/p") : undefined}
                src={viaOwnHost(variant.url, "/m")}
              />

              <div className="row">
                {video.variants.length > 1 && (
                  <select
                    value={choice}
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

                <a
                  className="download"
                  href={viaOwnHost(variant.url, "/m")}
                  download={fileName(post, videoIndex, variant)}
                >
                  Download {variant.label} MP4
                </a>
              </div>

              <div className="row">
                {length && <span className="meta">{length}</span>}
                <span className="meta">via this server</span>
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
        Public posts only. Media is streamed live from X through <code>/m/…</code> on this
        deployment — nothing is stored. Keep to content you have the right to download.
      </p>
    </main>
  );
}
