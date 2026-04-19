import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realitka — Back Office Agent",
  description: "AI asistent pro back office operace realitní kanceláře.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="h-full bg-bg text-text">{children}</body>
    </html>
  );
}
