import { prisma, Prisma } from "@auction/db";
import type { AuthUser } from "../plugins/auth.js";
import { AppError } from "../lib/errors.js";

type Tx = Prisma.TransactionClient;

export type AuditLogInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Synchronous audit write inside an existing DB transaction (preferred for admin mutations).
 */
export async function writeAuditLogTx(tx: Tx, input: AuditLogInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: toInputJson(input.before),
      after: toInputJson(input.after),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/** Fire-and-forget style helper outside a transaction (non-admin / best-effort). */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  await writeAuditLogTx(prisma, input);
}

function toInputJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  if (serialized === null) {
    return Prisma.JsonNull;
  }
  if (
    typeof serialized === "string" ||
    typeof serialized === "number" ||
    typeof serialized === "boolean" ||
    typeof serialized === "object"
  ) {
    return serialized;
  }
  return undefined;
}

export function requestMeta(request: { ip: string; headers: Record<string, unknown> }): {
  ip: string;
  userAgent: string | null;
} {
  const ua = request.headers["user-agent"];
  return {
    ip: request.ip,
    userAgent: typeof ua === "string" ? ua : null,
  };
}

export function assertActor(user: AuthUser | undefined): AuthUser {
  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return user;
}
