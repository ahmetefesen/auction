import { z } from "zod";
import { AuctionStatus, Role, UserStatus } from "./roles.js";

/** RFC 4122 UUID — REST path/query param validation */
export const uuidSchema = z.string().uuid("Invalid resource ID");

export const emailSchema = z
  .string()
  .email("Invalid email address")
  .max(255)
  .transform((v) => v.toLowerCase());

/** Strong password: min 8, upper, lower, digit, special. */
export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a digit")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

export const moneyCentsSchema = z
  .number()
  .int("Amount must be an integer in minor units")
  .nonnegative();

export const positiveMoneyCentsSchema = z
  .number()
  .int("Amount must be an integer in minor units")
  .positive("Amount must be a positive integer in minor units");

// --- Auth ---

const registerableRoleSchema = z.enum([Role.SELLER, Role.BUYER]);

export const RegisterSchema = z
  .object({
    email: emailSchema,
    password: strongPasswordSchema,
    displayName: z.string().min(1).max(100),
    /** Preferred: one or both of SELLER / BUYER */
    roles: z.array(registerableRoleSchema).min(1).max(2).optional(),
    /** @deprecated Prefer `roles` — still accepted for single-role clients */
    role: registerableRoleSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.roles?.length && !data.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide roles[] or role",
        path: ["roles"],
      });
    }
  })
  .transform((data) => {
    const raw = data.roles?.length ? data.roles : data.role ? [data.role] : [];
    const roles = [...new Set(raw)] as Array<"SELLER" | "BUYER">;
    return {
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      roles,
    };
  });
export type RegisterInput = z.infer<typeof RegisterSchema>;
/** @deprecated Use RegisterSchema */
export const registerSchema = RegisterSchema;

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;
/** @deprecated Use LoginSchema */
export const loginSchema = LoginSchema;

// --- Wallet ---

export const DepositSchema = z.object({
  amountCents: positiveMoneyCentsSchema.max(100_000_000, "Deposit too large"),
});
export type DepositInput = z.infer<typeof DepositSchema>;
/** @deprecated Use DepositSchema */
export const depositSchema = DepositSchema;

// --- Auction ---

const auctionBodyBase = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(10_000),
  startingPrice: positiveMoneyCentsSchema,
  reservePrice: positiveMoneyCentsSchema.optional(),
  buyNowPrice: positiveMoneyCentsSchema.optional(),
  minIncrement: positiveMoneyCentsSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

function refineAuctionDates<T extends { startsAt: string; endsAt: string }>(
  data: T,
  ctx: z.RefinementCtx,
): void {
  if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "endsAt must be after startsAt",
      path: ["endsAt"],
    });
  }
}

export const CreateAuctionSchema = auctionBodyBase.superRefine(refineAuctionDates);
export type CreateAuctionInput = z.infer<typeof CreateAuctionSchema>;
/** @deprecated Use CreateAuctionSchema */
export const createAuctionSchema = CreateAuctionSchema;

export const UpdateAuctionSchema = auctionBodyBase.partial().superRefine((data, ctx) => {
  if (data.startsAt !== undefined && data.endsAt !== undefined) {
    refineAuctionDates({ startsAt: data.startsAt, endsAt: data.endsAt }, ctx);
  }
});
export type UpdateAuctionInput = z.infer<typeof UpdateAuctionSchema>;
/** @deprecated Use UpdateAuctionSchema */
export const updateAuctionSchema = UpdateAuctionSchema;

/** Static early parse — amount must be positive minor units. Prefer factory with auction context. */
export const PlaceBidSchema = z.object({
  amountCents: positiveMoneyCentsSchema,
});
export type PlaceBidInput = z.infer<typeof PlaceBidSchema>;
/** @deprecated Use PlaceBidSchema */
export const placeBidSchema = PlaceBidSchema;

export const bidPreviewSchema = z.object({
  auctionId: uuidSchema,
  amountCents: moneyCentsSchema,
  minRequiredCents: moneyCentsSchema,
  meetsMinimum: z.boolean(),
  becomesLeader: z.boolean(),
  wouldExtend: z.boolean(),
  extendedEndsAt: z.string().datetime().nullable(),
  holdDeltaCents: moneyCentsSchema,
  availableBalanceCents: moneyCentsSchema,
  insufficientFunds: z.boolean(),
});
export type BidPreview = z.infer<typeof bidPreviewSchema>;

export type PlaceBidContext = {
  currentBid: number;
  minIncrement: number;
  startingPrice: number;
};

/** Bid amount must be >= currentBid + minIncrement (or startingPrice if no bids). */
export function createPlaceBidSchema(ctx: PlaceBidContext) {
  const minRequired =
    ctx.currentBid <= 0 ? ctx.startingPrice : ctx.currentBid + ctx.minIncrement;
  return z.object({
    amountCents: positiveMoneyCentsSchema.min(
      minRequired,
      `Minimum bid is ${minRequired} minor units`,
    ),
  });
}

/** Static early parse for proxy max. Prefer factory with auction context. */
export const SetProxyBidSchema = z.object({
  maxAmountCents: positiveMoneyCentsSchema,
});
export type SetProxyBidInput = z.infer<typeof SetProxyBidSchema>;
/** @deprecated Use SetProxyBidSchema */
export const proxyBidSchema = SetProxyBidSchema;

export type SetProxyBidContext = {
  currentBid: number;
};

/** Proxy max must be strictly greater than current visible bid. */
export function createSetProxyBidSchema(ctx: SetProxyBidContext) {
  const minExclusive = Math.max(ctx.currentBid, 0);
  return z.object({
    maxAmountCents: positiveMoneyCentsSchema.refine(
      (v) => v > minExclusive,
      minExclusive === 0
        ? "Proxy max must be a positive amount"
        : `Proxy max must be greater than current bid (${minExclusive})`,
    ),
  });
}

export const forceEndAuctionSchema = z.object({
  reason: z.string().min(5).max(2000),
});
export type ForceEndAuctionInput = z.infer<typeof forceEndAuctionSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().max(128).optional(),
  entityType: z.string().max(64).optional(),
  actorId: uuidSchema.optional(),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

export const auctionSnapshotBidSchema = z.object({
  id: uuidSchema,
  auctionId: uuidSchema,
  bidderId: uuidSchema,
  amount: moneyCentsSchema,
  isProxy: z.boolean(),
  createdAt: z.string().datetime(),
});

export const auctionSnapshotSchema = z.object({
  serverTime: z.string().datetime(),
  auction: z.object({
    id: uuidSchema,
    status: z.enum([
      AuctionStatus.DRAFT,
      AuctionStatus.SCHEDULED,
      AuctionStatus.LIVE,
      AuctionStatus.NEGOTIATING,
      AuctionStatus.ENDED,
      AuctionStatus.CANCELLED,
      AuctionStatus.SETTLED,
    ]),
    currentBid: moneyCentsSchema,
    currentWinnerId: uuidSchema.nullable(),
    endsAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
    minIncrement: positiveMoneyCentsSchema,
    startingPrice: positiveMoneyCentsSchema,
    antiSnipeWindowSec: z.number().int().positive(),
    antiSnipeExtendSec: z.number().int().positive(),
    negotiationExpiresAt: z.string().datetime().nullable().optional(),
    counterOfferCents: moneyCentsSchema.nullable().optional(),
  }),
  bids: z.array(auctionSnapshotBidSchema),
  wallet: z
    .object({
      availableBalance: moneyCentsSchema,
      heldBalance: moneyCentsSchema,
    })
    .nullable(),
});
export type AuctionSnapshot = z.infer<typeof auctionSnapshotSchema>;

export const queueJobCountsSchema = z.object({
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
});

export const adminMetricsSchema = z.object({
  serverTime: z.string().datetime(),
  sockets: z.object({
    active: z.number().int().nonnegative().nullable(),
  }),
  redis: z.object({
    latencyMs: z.number().nonnegative().nullable(),
    ok: z.boolean(),
  }),
  postgres: z.object({
    latencyMs: z.number().nonnegative().nullable(),
    ok: z.boolean(),
  }),
  wallet: z.object({
    totalHeldBalance: moneyCentsSchema,
    totalAvailableBalance: moneyCentsSchema,
  }),
  auctions: z.object({
    liveCount: z.number().int().nonnegative(),
    endingSoonCount: z.number().int().nonnegative(),
  }),
  queues: z.object({
    email: queueJobCountsSchema.nullable(),
    auctionCloser: queueJobCountsSchema.nullable(),
  }),
});
export type AdminMetrics = z.infer<typeof adminMetricsSchema>;

export const auctionListQuerySchema = z.object({
  status: z
    .enum([
      AuctionStatus.DRAFT,
      AuctionStatus.SCHEDULED,
      AuctionStatus.LIVE,
      AuctionStatus.NEGOTIATING,
      AuctionStatus.ENDED,
      AuctionStatus.CANCELLED,
      AuctionStatus.SETTLED,
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type AuctionListQuery = z.infer<typeof auctionListQuerySchema>;

export const CounterOfferSchema = z.object({
  amountCents: positiveMoneyCentsSchema,
});
export type CounterOfferInput = z.infer<typeof CounterOfferSchema>;

// --- API responses ---

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export function PaginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
}
