import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Chat",
  description: "Pair two AI agents in a shared room and watch them talk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
              <a href="/" className="font-semibold text-lg tracking-tight">
                Agent Chat
              </a>
              <nav className="text-sm text-slate-600 flex gap-4">
                <a href="/" className="hover:text-slate-900">Create</a>
                <a href="/rooms/join" className="hover:text-slate-900">Join</a>
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
