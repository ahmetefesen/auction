"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatTry } from "@/lib/format";

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
  role: string;
  status: string;
};

export default function AdminPage() {
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [live, setLive] = useState<LiveAuction[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState({ action: "", entityType: "", actorId: "" });
  const [forceReason, setForceReason] = useState("");
  const [forceTarget, setForceTarget] = useState<LiveAuction | null>(null);

  function load(): void {
    startTransition(async () => {
      try {
        const params = new URLSearchParams();
        if (filters.action) params.set("action", filters.action);
        if (filters.entityType) params.set("entityType", filters.entityType);
        if (filters.actorId) params.set("actorId", filters.actorId);
        const [audit, userRes, liveRes] = await Promise.all([
          apiFetch<{ items: AuditItem[] }>(`/admin/audit-logs?${params.toString()}`),
          apiFetch<{ users: UserItem[] }>("/admin/users"),
          apiFetch<{ items: LiveAuction[] }>("/admin/auctions/live"),
        ]);
        setLogs(audit.items);
        setUsers(userRes.users);
        setLive(liveRes.items);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Admin access required");
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

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
        setError(err instanceof Error ? err.message : "Update failed");
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
        setError(err instanceof Error ? err.message : "Force action failed");
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-display text-4xl text-mist-50">Admin</h1>
      <p className="mt-2 text-mist-300">Live ops, emergency controls, and audit trail.</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}

      <h2 className="mt-10 text-lg text-brass-400">Live auctions</h2>
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
                {formatTry(a.currentBid)} · ends {new Date(a.endsAt).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              className="border border-red-400/40 px-3 py-1.5 text-red-300 hover:bg-red-400/10"
              onClick={() => setForceTarget(a)}
            >
              Force End / Cancel
            </button>
          </li>
        ))}
        {live.length === 0 ? <li className="text-mist-300">No live auctions.</li> : null}
      </ul>

      <h2 className="mt-10 text-lg text-brass-400">Users</h2>
      <ul className="mt-3 space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between border-b border-white/10 py-2 text-sm">
            <span>
              {u.displayName} · {u.email} · {u.role} · {u.status}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleStatus(u)}
              className="text-brass-400 hover:underline"
            >
              Toggle status
            </button>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg text-brass-400">Audit log</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder="Filter action"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder="Entity type"
          value={filters.entityType}
          onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
        />
        <input
          className="border border-white/15 bg-ink-900 px-3 py-2 text-sm"
          placeholder="Actor id"
          value={filters.actorId}
          onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
        />
      </div>
      <button
        type="button"
        className="mt-2 text-sm text-brass-400 hover:underline"
        onClick={load}
      >
        Apply filters
      </button>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-mist-300">
            <tr className="border-b border-white/10">
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Actor</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Entity</th>
              <th className="py-2 pr-3">IP</th>
              <th className="py-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-white/5 align-top text-mist-100">
                <td className="py-2 pr-3 whitespace-nowrap text-mist-300">
                  {new Date(l.createdAt).toLocaleString()}
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
            <h3 className="font-display text-2xl text-mist-50">Emergency action</h3>
            <p className="mt-2 text-sm text-mist-300">{forceTarget.title}</p>
            <label className="mt-4 block text-sm text-mist-300">
              Mandatory reason (audit log)
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
                Force end
              </button>
              <button
                type="button"
                disabled={pending || forceReason.trim().length < 5}
                onClick={() => confirmForce("cancel")}
                className="border border-red-400/50 px-3 py-2 text-sm text-red-300 disabled:opacity-50"
              >
                Force cancel
              </button>
              <button
                type="button"
                className="px-3 py-2 text-sm text-mist-300"
                onClick={() => {
                  setForceTarget(null);
                  setForceReason("");
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
