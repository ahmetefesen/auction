"use client";

import { useEffect, useState } from "react";

type Flash = {
  kind: "welcome" | "signed_in";
  name: string;
};

export function FlashBanner() {
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("lotforge_flash");
    if (!raw) return;
    sessionStorage.removeItem("lotforge_flash");
    try {
      const parsed = JSON.parse(raw) as Flash;
      if (parsed?.name && (parsed.kind === "welcome" || parsed.kind === "signed_in")) {
        setFlash(parsed);
      }
    } catch {
      // ignore bad flash payload
    }
  }, []);

  if (!flash) return null;

  const message =
    flash.kind === "welcome"
      ? `Hoş geldin, ${flash.name}! Hesabın hazır.`
      : `Tekrar hoş geldin, ${flash.name}.`;

  return (
    <p
      role="status"
      className="mb-6 border border-brass-500/40 bg-brass-500/10 px-4 py-3 text-sm text-brass-300"
    >
      {message}
    </p>
  );
}
