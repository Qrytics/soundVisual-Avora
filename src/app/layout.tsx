import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "soundVisual — Avora",
  description:
    "An audio-reactive kinetic ball experiment. Fuel the ball with your voice and watch the screen shatter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#050508] overflow-hidden">
        {children}
      </body>
    </html>
  );
}
