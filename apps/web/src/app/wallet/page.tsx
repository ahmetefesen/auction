"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { RealtimeEvent, type WalletUpdatedPayload } from "@auction/shared";
import { API_URL, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { formatTry } from "@/lib/format";
import { useT, useLocale, localeToBcp47 } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";
import { MoneyInput } from "@/components/ui/MoneyInput";

type WalletTx = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  heldAfter: number;
  createdAt: string;
};

type WalletResponse = {
  wallet: { availableBalance: number; heldBalance: number };
  transactions: WalletTx[];
};

export default function WalletPage() {
  const t = useT();
  const { locale } = useLocale();
  const formatError = useFormatApiError();
  const bcp47 = localeToBcp47(locale);
  const { loaded, isBuyer, refresh: refreshSession } = useSession();
  const [data, setData] = useState<WalletResponse | null>(null);
  const [amountCents, setAmountCents] = useState<number | null>(10_000);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((): void => {
    startTransition(async () => {
      try {
        const res = await apiFetch<WalletResponse>("/wallets/me");
        setData(res);
        setError(null);
      } catch (err) {
        setError(formatError(err));
      }
    });
  }, [formatError]);

  useEffect(() => {
    if (!loaded || !isBuyer) return;
    load();
  }, [loaded, isBuyer, load]);

  useEffect(() => {
    if (!loaded || !isBuyer) return;
    const socket: Socket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socket.on(RealtimeEvent.WALLET_UPDATED, (payload: WalletUpdatedPayload) => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              wallet: {
                availableBalance: payload.availableBalance,
                heldBalance: payload.heldBalance,
              },
            }
          : {
              wallet: {
                availableBalance: payload.availableBalance,
                heldBalance: payload.heldBalance,
              },
              transactions: [],
            },
      );
      void refreshSession();
    });
    return () => {
      socket.disconnect();
    };
  }, [loaded, isBuyer, refreshSession]);

  function deposit(): void {
    if (amountCents == null || amountCents <= 0) return;
    startTransition(async () => {
      try {
        await apiFetch("/wallets/deposit", {
          method: "POST",
          body: JSON.stringify({ amountCents }),
        });
        load();
        void refreshSession();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  function txLabel(type: string): string {
    const key = `wallet.tx.${type}`;
    const label = t(key);
    return label !== key ? label : type;
  }

  if (loaded && !isBuyer) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl text-mist-50">{t("wallet.title")}</h1>
        <p className="mt-4 text-mist-300">
          {t("wallet.buyerOnly")}{" "}
          <Link href="/login" className="text-brass-400 hover:underline">
            {t("wallet.signIn")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-4xl text-mist-50">{t("wallet.title")}</h1>
      <p className="mt-2 text-mist-300">{t("wallet.subtitle")}</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      {data ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="border border-white/10 p-5">
            <p className="text-sm text-mist-300">{t("wallet.available")}</p>
            <p className="font-display text-3xl text-brass-400">
              {formatTry(data.wallet.availableBalance)}
            </p>
          </div>
          <div className="border border-white/10 p-5">
            <p className="text-sm text-mist-300">{t("wallet.held")}</p>
            <p className="font-display text-3xl text-mist-50">
              {formatTry(data.wallet.heldBalance)}
            </p>
          </div>
        </div>
      ) : null}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end">
        <MoneyInput
          className="flex-1"
          label={t("wallet.depositLabel")}
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          disabled={pending}
        />
        <button
          type="button"
          disabled={pending || amountCents == null}
          onClick={deposit}
          className="bg-brass-500 px-4 py-2 font-semibold text-ink-950 disabled:opacity-60"
        >
          {t("wallet.mockDeposit")}
        </button>
      </div>
      <ul className="mt-10 space-y-2">
        {(data?.transactions ?? []).map((tx) => (
          <li key={tx.id} className="border-b border-white/5 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-mist-300">
                {txLabel(tx.type)} · {new Date(tx.createdAt).toLocaleString(bcp47)}
              </span>
              <span className="text-mist-50">{formatTry(tx.amount)}</span>
            </div>
            <p className="mt-0.5 text-xs text-mist-300">
              {t("wallet.after", {
                available: formatTry(tx.balanceAfter),
                held: formatTry(tx.heldAfter),
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
