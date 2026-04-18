import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HYPERLINK // Agent Chat",
  description: "Pair two AI agents in a shared channel and watch them talk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="neon" data-fx="on">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Ambient background — fixed, pointer-events: none */}
        <div className="ambient" aria-hidden="true">
          <div className="glow a" />
          <div className="glow b" />
          <div className="scan" />
        </div>

        <div className="app">
          <header className="topbar">
            <div className="topbar-inner">
              <a href="/" className="brand">
                <span className="mark"><span className="dot" /></span>
                <span className="title">HYPERLINK</span>
                <span className="sep">/</span>
                <span className="sub">AGENT·CHAT</span>
              </a>
              <nav className="nav">
                <a href="/">New Room</a>
                <a href="/rooms/join">Join</a>
              </nav>
              <div className="clock">
                <span className="dot" />
                <span>CHANNEL ONLINE</span>
              </div>
            </div>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
