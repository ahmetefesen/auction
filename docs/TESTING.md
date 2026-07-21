# Integration Tests (Hafta 1)

Critical-path integration tests for live bidding, anti-sniping, idempotency, and reconnect snapshot sync.

## Prerequisites

1. Start infrastructure:

```bash
docker compose up -d postgres redis
```

2. Apply migrations and ensure `.env` exists (copy from `.env.example`).

3. Install dependencies:

```bash
pnpm install
```

## Run tests

From repo root:

```bash
pnpm test:integration
```

From API package:

```bash
pnpm --filter @auction/api test
```

Watch mode:

```bash
pnpm --filter @auction/api test:watch
```

## What is covered

| Test | Validates |
|------|-----------|
| Concurrent opening bids | Exactly one winner, total held escrow = winning bid, loser rejected |
| Anti-sniping extension | `endsAt` extends inside snipe window; `endAndSettleAuction` does not close early |
| Idempotency-Key replay | Same key returns same `bidId`, single bid row, single hold |
| Snapshot endpoint | Authoritative `currentBid`, bids, wallet after reconnect |
| Admin metrics auth | Admin gets `/admin/metrics`; buyer gets 403 |
| Public `/health` | Reports postgres + redis dependency status |
| Bid preview | Floor / holdDelta / anti-snipe / insufficient funds |
| maskBidderId | Stable `User***xx` alias without full UUID |
| Lot bid rate limit | Burst of 3 then `429 BID_RATE_LIMITED`; buckets isolated per auction |

## Acceptance criteria

- Tests run sequentially against PostgreSQL + Redis (no parallel DB races in CI).
- Reconnect catch-up: `GET /auctions/:id/snapshot` returns server time, auction version, last 50 bids, and viewer wallet when authenticated.
- Client clears optimistic bid state when snapshot or confirmed socket bid arrives.
- Failed bids roll back optimistic UI and show error message (manual QA in auction room).

## UI smoke checklist (manual)

After `pnpm dev`, verify:

1. Guest opens `/auctions/:id` — socket connects (not permanently “Kopuk”), bid form requires login.
2. Buyer login → header shows Cüzdan + İzleme (not Admin); wallet badge amount visible.
3. Place bid → preview in TRY; outbid flash; wallet held updates on `/wallet` without full reload.
4. Watchlist toggle on lot → appears on `/watchlist`.
5. Seller: draft save, image upload, reserve, then publish; cancel draft/live.
6. `GET /auctions/:id/proxy-bid` returns current max for buyer after `PUT`.

## Socket auth

Socket.IO allows guest connections (optional cookie). Authenticated users still join `user:{id}` for `wallet.updated`. Auction rooms remain readable by guests via `auction:join`.
