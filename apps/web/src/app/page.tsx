"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function HomePage() {
  const t = useT();
  return (
    <section className="relative min-h-[calc(100vh-4.5rem)] overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?auto=format&fit=crop&w=2000&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4.5rem)] max-w-6xl flex-col justify-end px-6 pb-24 pt-20">
        <p className="font-display text-6xl leading-none text-mist-50 md:text-8xl">Lotforge</p>
        <h1 className="mt-4 max-w-xl text-lg text-mist-300 md:text-xl">{t("home.tagline")}</h1>
        <div className="mt-8 flex gap-3">
          <Link
            href="/auctions"
            className="rounded bg-brass-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brass-400"
          >
            {t("home.browse")}
          </Link>
          <Link
            href="/register"
            className="rounded border border-mist-300/40 px-5 py-2.5 text-sm text-mist-100 hover:border-mist-100"
          >
            {t("home.createAccount")}
          </Link>
        </div>
      </div>
    </section>
  );
}
