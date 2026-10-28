import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Post video downloader",
  description: "Paste an X post link and download its video through your own host.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
