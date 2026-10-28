/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Used for the in-page preview player only. Downloads go through /api/media,
      // which relays the video in chunks under Vercel's 4.5 MB response payload cap.
      { source: "/m/:path*", destination: "https://video.twimg.com/:path*" },
    ];
  },
};

export default nextConfig;
