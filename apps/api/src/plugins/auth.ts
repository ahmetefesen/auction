import type { FastifyRequest } from "fastify";
import { prisma } from "@auction/db";
import {
  Role,
  UserStatus,
  hasAnyRole,
  rolesEqual,
  sortRoles,
  type Role as RoleType,
} from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { ACCESS_COOKIE, verifyAccessToken } from "../lib/auth-tokens.js";
import { loadUserRoles } from "../lib/user-roles.js";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  roles: RoleType[];
  status: typeof UserStatus.ACTIVE | typeof UserStatus.SUSPENDED;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Validates JWT access cookie and attaches `request.user`. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const env = request.server.env;
  const token = request.cookies[ACCESS_COOKIE];
  if (!token) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  const payload = await verifyAccessToken(env, token);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new AppError(401, "UNAUTHORIZED", "User inactive or not found");
  }
  const roles = await loadUserRoles(user.id);
  if (roles.length === 0 || !rolesEqual(roles, payload.roles)) {
    throw new AppError(401, "UNAUTHORIZED", "Token role mismatch");
  }
  request.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: sortRoles(roles),
    status: user.status,
  };
}

/** Strict RBAC: user must have at least one of the required roles. */
export function requireRole(...roles: readonly RoleType[]) {
  return async (request: FastifyRequest): Promise<void> => {
    await requireAuth(request);
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    if (!hasAnyRole(user.roles, ...roles)) {
      throw new AppError(403, "FORBIDDEN", "Insufficient permissions");
    }
  };
}

/** @deprecated Prefer requireRole */
export const requireRoles = requireRole;
/** @deprecated Prefer requireAuth */
export const authenticate = requireAuth;

export const requireBuyer = requireRole(Role.BUYER);
export const requireSeller = requireRole(Role.SELLER, Role.ADMIN);
export const requireAdmin = requireRole(Role.ADMIN);

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies[ACCESS_COOKIE];
  if (!token) {
    return;
  }
  try {
    await requireAuth(request);
  } catch {
    // public route — ignore invalid token
  }
}
