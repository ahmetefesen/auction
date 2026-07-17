# Lotforge — Real-Time Auction Platform

Enterprise-grade online auction monorepo: Fastify API, Next.js web, PostgreSQL, Prisma, Redis, Socket.IO, BullMQ.

## Stack

- `apps/api` — Fastify REST API, Socket.IO + Redis adapter, BullMQ workers
- `apps/web` — Next.js 15 App Router + Tailwind
- `packages/db` — Prisma schema, PostgreSQL migrations, `SELECT … FOR UPDATE` lock helpers
- `packages/shared` — Zod schemas, Role enums, realtime events, `formatZodError`
- `packages/config` — shared `tsconfig.base.json` + ESLint flat config

## Workspace layout

```
AUCTION/
├── apps/api
├── apps/web
├── packages/config
├── packages/shared
├── packages/db
├── pnpm-workspace.yaml    # apps/* + packages/*
├── turbo.json
└── docker-compose.yml     # Postgres 16, Redis 7, Mailhog
```

## Bootstrap (exact commands)

```bash
# Node 20+ and pnpm
corepack enable
corepack prepare pnpm@9.15.0 --activate

cd /path/to/AUCTION
cp .env.example .env

# Dependencies
pnpm install

# Shared packages
pnpm --filter @auction/shared build
pnpm --filter @auction/db generate
pnpm --filter @auction/db build

# Infra: PostgreSQL 16, Redis 7, Mailhog
docker compose up -d

# Wait for Postgres healthcheck, then apply schema + seed
pnpm db:migrate
pnpm db:seed

# Dev servers
pnpm --filter @auction/api exec -- mkdir -p uploads
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000
- Mailhog UI: http://localhost:8025
- Postgres (compose): `localhost:5432` user/db `auction` / password `auction`
- Redis (compose): `localhost:6379`

If Docker Redis conflicts with a local Redis already on 6379, stop one of them or change the published port.

## Database: PostgreSQL 16

The app uses **PostgreSQL** via Prisma. Connection string:

```
DATABASE_URL=postgresql://auction:auction@localhost:5432/auction?schema=public
```

### Schema highlights

- Native `@db.Uuid` primary/foreign keys
- `@@check` constraints: non-negative wallet balances, positive bid/transaction amounts, `endsAt > startsAt`
- `TIMESTAMPTZ(3)` for all timestamps
- Immutable append-only tables: `Bid`, `WalletTransaction`, `AuditLog`
- Pessimistic locking: `lockAuctionById`, `lockWalletsByUserIds` use `SELECT … FOR UPDATE`
- Serializable transactions on bid/wallet critical paths

### Migrations

```bash
pnpm db:migrate          # dev: create/apply migrations
pnpm db:seed             # demo users + live auction
pnpm --filter @auction/db migrate:deploy   # production deploy
```

## Demo accounts

| Email | Password | Role |
|-------|----------|------|
| admin@auction.local | Password123! | ADMIN |
| seller@auction.local | Password123! | SELLER |
| buyer@auction.local | Password123! | BUYER |
| buyer2@auction.local | Password123! | BUYER |

Buyers are seeded with 5000.00 TRY available balance.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + web via Turborepo |
| `pnpm build` | Build all packages/apps |
| `pnpm lint` | Shared ESLint + typecheck (where configured) |
| `pnpm db:migrate` | Apply Prisma migrations (PostgreSQL) |
| `pnpm db:seed` | Demo users + live lot |
| `docker compose up -d` | Postgres + Redis + Mailhog |
