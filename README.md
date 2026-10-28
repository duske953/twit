# Post video downloader

Paste an X / Twitter post link, get the video. The bytes are streamed through your own
deployment, so it keeps working when `video.twimg.com` is blocked (DNS or otherwise) on
the network you are browsing from.

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests for link parsing + response normalising
npm run build
```

## Deploy to Vercel

```bash
npx vercel        # or push the repo and import it in the dashboard
```

No environment variables, no API keys, no database.

## How it works

```
browser ──▶ /api/resolve            ──▶ cdn.syndication.twimg.com  (post metadata)
browser ──▶ /api/media (4 MB × n)   ──▶ video.twimg.com           (video bytes)
browser ──▶ /api/poster             ──▶ pbs.twimg.com             (thumbnail)
browser ──▶ /m/…                    ──▶ video.twimg.com           (preview player only)
```

Design notes, because the obvious approach does not survive Vercel's limits:

1. **Downloads are relayed in bounded chunks.** Vercel caps a Function response at 4.5 MB,
   and a real post video is 10–130 MB. So `/api/media` returns one window of the file at a
   time (≤ 4 MB, capped server-side even if the CDN ignores `Range`), and the browser
   assembles the pieces into a Blob before saving. That keeps every response legal no matter
   how big the video is, and a failed chunk surfaces a readable error instead of the
   browser's opaque "file couldn't be accessed".
2. **The preview player uses a rewrite** (`/m/:path*` → `video.twimg.com`) so `<video>` can
   stream and seek without downloading anything. This is a nicety; downloads do not depend
   on it.
3. **Metadata comes from public embed endpoints.** The post ID is parsed out of the link
   you paste and used to query `cdn.syndication.twimg.com` — the same endpoint that powers
   official embedded posts — with `api.fxtwitter.com` as a fallback when it rate-limits.
   No user-supplied URL is ever fetched, so this cannot be used as an open proxy.

`/api/check?url=<link>` reports what each source answered (`status`, `error`, `note`) plus
what Vercel's own server saw when fetching the MP4, which is the fastest way to tell a bad
link apart from throttling apart from a blocked network.

Because the browser only ever talks to your domain, blocking `x.com`, `video.twimg.com` or
`pbs.twimg.com` locally does not matter; the deployment fetches them on your behalf.

## Limits worth knowing

- **Public posts only.** Private/protected posts and anything behind the login wall are not
  reachable this way, and X's own API would be needed for them.
- **The metadata endpoints are unofficial.** They are the ones X's embed widgets use, so
  they are stable in practice, but they are undocumented and are not covered by any
  contract. They can rate-limit datacenter IPs; the fxtwitter fallback covers most cases.
- **Live video, broadcasts and Spaces are not supported** — they are HLS streams, not MP4
  files, and are filtered out.
- **Rate limits** are X's, not ours. If lookups start failing, it is almost always their
  endpoint throttling; it usually recovers in a few minutes.
- **Very large videos** are assembled in browser memory chunk by chunk. A 40 MB 1080p file
  is fine; a 400 MB 4K file may strain a low-memory device — pick a lower quality there.
- **This is a personal tool.** Re-hosting it as a public service, or using it to bulk
  scrape media, is against X's terms and is not what this is built for.
