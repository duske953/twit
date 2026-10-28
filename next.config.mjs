/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Video bytes are proxied at the edge by Vercel's rewrite layer, NOT by a
      // Function. Functions cap responses at 4.5 MB, which would break any real
      // video; a rewrite has no such limit and streams with Range support.
      { source: "/m/:path*", destination: "https://video.twimg.com/:path*" },
      // Poster/thumbnail images, same idea.
      { source: "/p/:path*", destination: "https://pbs.twimg.com/:path*" },
    ];
  },
};

export default nextConfig;
