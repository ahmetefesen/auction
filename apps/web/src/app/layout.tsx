import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lotforge Auctions",
  description: "Real-time online auction platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="font-sans antialiased">
        <header className="border-b border-white/10 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-display text-2xl tracking-wide text-brass-400">
              Lotforge
            </Link>
            <nav className="flex items-center gap-5 text-sm text-mist-300">
              <Link href="/auctions" className="hover:text-mist-50">
                Auctions
              </Link>
              <Link href="/wallet" className="hover:text-mist-50">
                Wallet
              </Link>
              <Link href="/seller" className="hover:text-mist-50">
                Seller
              </Link>
              <Link href="/admin" className="hover:text-mist-50">
                Admin
              </Link>
              <Link
                href="/login"
                className="rounded border border-brass-500/60 px-3 py-1.5 text-brass-400 hover:bg-brass-500/10"
              >
                Sign in
              </Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
