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
browser ──▶ your-domain/api/resolve ──▶ cdn.syndication.twimg.com   (post metadata)
        ──▶ your-domain/m/…         ──▶ video.twimg.com            (the video bytes)
        ──▶ your-domain/p/…         ──▶ pbs.twimg.com              (poster images)
```

Two deliberate design choices:

1. **Media is proxied by rewrites, not by a Function.** Vercel caps Function responses at
   4.5 MB, which every real tweet video exceeds. Rewrites (`/m/:path*`, `/p/:path*` in
   `next.config.mjs`) are handled by Vercel's proxy layer instead, so there is no payload
   cap, `Range` requests work (seeking / resuming), and nothing is buffered or stored.
2. **Metadata comes from public embed endpoints.** The post ID is parsed out of the link
   you paste and used to query `cdn.syndication.twimg.com` — the same endpoint that powers
   official embedded posts — with `api.fxtwitter.com` as a fallback when it rate-limits.
   No user-supplied URL is ever fetched, so this cannot be used as an open proxy.

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
- **This is a personal tool.** Re-hosting it as a public service, or using it to bulk
  scrape media, is against X's terms and is not what this is built for.
