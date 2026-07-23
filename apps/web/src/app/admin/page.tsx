"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { AdminMetricsDto } from "@auction/shared";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { formatTry } from "@/lib/format";
import { useT, useLocale, localeToBcp47 } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};

type LiveAuction = {
  id: string;
  title: string;
  currentBid: number;
  endsAt: string;
  sellerId: string;
};

type UserItem = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  status: string;
};

const METRICS_POLL_MS = 8_000;

function HealthCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="border border-white/10 bg-ink-900/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-mist-300">{label}</p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${warn ? "text-red-300" : "text-mist-50"}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-mist-300">{hint}</p> : null}
    </div>
  );
}

export default function AdminPage() {
  const t = useT();
  const { locale } = useLocale();
  const formatError = useFormatApiError();
  const bcp47 = localeToBcp47(locale);
  const { loaded, isAdmin } = useSession();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [live, setLive] = useState<LiveAuction[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [metrics, setMetrics] = useState<AdminMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState({ action: "", entityType: "", actorId: "" });
  const [forceReason, setForceReason] = useState("");
  const [forceTarget, setForceTarget] = useState<LiveAuction | null>(null);

  const loadMetrics = useCallback(async (): Promise<void> => {
    try {
      const data = await apiFetch<AdminMetricsDto>("/admin/metrics");
      setMetrics(data);
    } catch {
      // keep last snapshot; panel error handled by main load
    }
  }, []);

  function load(): void {
    startTransition(async () => {
      try {
        const params = new URLSearchParams();
        if (filters.action) params.set("action", filters.action);
        if (filters.entityType) params.set("entityType", filters.entityType);
        if (filters.actorId) params.set("actorId", filters.actorId);
        const [audit, userRes, liveRes, metricsRes] = await Promise.all([
          apiFetch<{ items: AuditItem[] }>(`/admin/audit-logs?${params.toString()}`),
          apiFetch<{ users: UserItem[] }>("/admin/users"),
          apiFetch<{ items: LiveAuction[] }>("/admin/auctions/live"),
          apiFetch<AdminMetricsDto>("/admin/metrics"),
        ]);
        setLogs(audit.items);
        setUsers(userRes.users);
        setLive(liveRes.items);
        setMetrics(metricsRes);
        setError(null);
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  useEffect(() => {
    if (!loaded || !isAdmin) return;
    load();
  }, [loaded, isAdmin]);

  useEffect(() => {
    if (!loaded || !isAdmin) return;
    const id = window.setInterval(() => {
      void loadMetrics();
    }, METRICS_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadMetrics, loaded, isAdmin]);

  if (loaded && !isAdmin) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="font-display text-4xl text-mist-50">{t("admin.title")}</h1>
        <p className="mt-4 text-mist-300">
          {t("admin.adminOnly")}{" "}
          <Link href="/login" className="text-brass-400 hover:underline">
            {t("admin.signIn")}
          </Link>
        </p>
      </div>
    );
  }

  function toggleStatus(user: UserItem): void {
    startTransition(async () => {
      try {
        await apiFetch(`/admin/users/${user.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({
            status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
          }),
        });
        load();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  function confirmForce(action: "end" | "cancel"): void {
    if (!forceTarget) return;
    startTransition(async () => {
      try {
        const path =
          action === "end"
            ? `/admin/auctions/${forceTarget.id}/force-end`
            : `/admin/auctions/${forceTarget.id}/force-cancel`;
        await apiFetch(path, {
          method: "POST",
          body: JSON.stringify({ reason: forceReason }),
        });
        setForceTarget(null);
        setForceReason("");
        load();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  const emailFailed = metrics?.queues.email?.failed ?? 0;
  const closerFailed = metrics?.queues.auctionCloser?.failed ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-display text-4xl text-mist-50">{t("admin.title")}</h1>
      <p className="mt-2 text-mist-300">{t("admin.subtitle")}</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}

      <h2 className="mt-10 text-lg text-brass-400">{t("admin.systemHealth")}</h2>
      <p className="mt-1 text-xs text-mist-300">
        {t("admin.autoRefresh", { sec: METRICS_POLL_MS / 1000 })}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HealthCard
          label={t("admin.activeSockets")}
          value={metrics?.sockets.active == null ? "—" : String(metrics.sockets.active)}
          hint={metrics?.sockets.active == null ? t("admin.socketHint") : undefined}
        />
        <HealthCard
          label={t("admin.redisLatency")}
          value={
            metrics?.redis.latencyMs == null ? "down" : `${metrics.redis.latencyMs} ms`
          }
          warn={metrics ? !metrics.redis.ok : false}
        />
        <HealthCard
          label={t("admin.postgresLatency")}
          value={
            metrics?.postgres.latencyMs == null ? "down" : `${metrics.postgres.latencyMs} ms`
          }
          warn={metrics ? !metrics.postgres.ok : false}
        />
        <HealthCard
          label={t("admin.heldBalance")}
          value={metrics ? formatTry(metrics.wallet.totalHeldBalance) : "—"}
          hint={
            metrics
              ? t("admin.availableHint", {
                  amount: formatTry(metrics.wallet.totalAvailableBalance),
                })
              : undefined
          }
        />
        <HealthCard
          label={t("admin.liveAuctions")}
          value={metrics ? String(metrics.auctions.liveCount) : "—"}
          hint={
            metrics
              ? t("admin.endingSoon", { count: metrics.auctions.endingSoonCount })
              : undefined
          }
        />
        <HealthCard
          label={t("admin.queueFailures")}
          value={metrics ? String(emailFailed + closerFailed) : "—"}
          hint={
            metrics
              ? t("admin.queueHint", { email: emailFailed, closer: closerFailed })
              : undefined
          }
          warn={emailFailed + closerFailed > 0}
        />
      </div>

      <h2 className="mt-10 text-lg text-brass-400">{t("admin.liveSection")}</h2>
      <ul className="mt-3 space-y-2">
        {live.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3 text-sm"
          >
            <div>
              <Link href={`/auctions/${a.id}`} className="text-mist-50 hover:text-brass-400">
                {a.title}
              </Link>
              <p className="text-mist-300">
                {formatTry(a.currentBid)} · {t("admin.ends")}{" "}
                {new Date(a.endsAt).toLocaleString(bcp47)}
              </p>
            </div>
            <button
              type="button"
              className="border border-red-400/40 px-3 py-1.5 text-red-300 hover:bg-red-400/10"
              onClick={() => setForceTarget(a)}
            >
              {t("admin.forceEndCancel")}
            </button>
          </li>
        ))}
        {live.length === 0 ? <li className="text-mist-300">{t("admin.noLive")}</li> : null}
      </ul>

      <h2 className="mt-10 text-lg text-brass-400">{t("admin.users")}</h2>
      <ul className="mt-3 space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between border-b border-white/10 py-2 text-sm">
            <span>
              {u.displayName} · {u.email} · {(u.roles ?? []).join(", ")} · {u.status}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleStatus(u)}
              className="text-brass-400 hover:underline"
            >
              {t("admin.toggleStatus")}
            </button>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg text-brass-400">{t("admin.auditLog")}</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder={t("admin.filterAction")}
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder={t("admin.entityType")}
          value={filters.entityType}
          onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
        />
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder={t("admin.actorId")}
          value={filters.actorId}
          onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
        />
      </div>
      <button
        type="button"
        className="mt-2 text-sm text-brass-400 hover:underline"
        onClick={load}
      >
        {t("admin.applyFilters")}
      </button>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-mist-300">
            <tr className="border-b border-white/10">
              <th className="py-2 pr-3">{t("admin.time")}</th>
              <th className="py-2 pr-3">{t("admin.actor")}</th>
              <th className="py-2 pr-3">{t("admin.action")}</th>
              <th className="py-2 pr-3">{t("admin.entity")}</th>
              <th className="py-2 pr-3">{t("admin.ip")}</th>
              <th className="py-2">{t("admin.diff")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-white/5 align-top text-mist-100">
                <td className="py-2 pr-3 whitespace-nowrap text-mist-300">
                  {new Date(l.createdAt).toLocaleString(bcp47)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{l.actorId?.slice(0, 8) ?? "—"}</td>
                <td className="py-2 pr-3 text-brass-400">{l.action}</td>
                <td className="py-2 pr-3">
                  {l.entityType} {l.entityId?.slice(0, 8)}
                </td>
                <td className="py-2 pr-3 text-mist-300">{l.ip ?? "—"}</td>
                <td className="py-2">
                  <pre className="max-w-xs overflow-x-auto whitespace-pre-wrap text-xs text-mist-300">
                    {JSON.stringify({ before: l.before, after: l.after }, null, 0)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {forceTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md border border-red-400/30 bg-ink-900 p-6">
            <h3 className="font-display text-2xl text-mist-50">{t("admin.emergency")}</h3>
            <p className="mt-2 text-sm text-mist-300">{forceTarget.title}</p>
            <label className="mt-4 block text-sm text-mist-300">
              {t("admin.reason")}
              <textarea
                className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2"
                rows={4}
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || forceReason.trim().length < 5}
                onClick={() => confirmForce("end")}
                className="bg-brass-500 px-3 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
              >
                {t("admin.forceEnd")}
              </button>
              <button
                type="button"
                disabled={pending || forceReason.trim().length < 5}
                onClick={() => confirmForce("cancel")}
                className="border border-red-400/50 px-3 py-2 text-sm text-red-300 disabled:opacity-50"
              >
                {t("admin.forceCancel")}
              </button>
              <button
                type="button"
                className="px-3 py-2 text-sm text-mist-300"
                onClick={() => {
                  setForceTarget(null);
                  setForceReason("");
                }}
              >
                {t("admin.dismiss")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
