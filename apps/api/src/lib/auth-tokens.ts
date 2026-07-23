import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { Role, sortRoles, type Role as RoleType } from "@auction/shared";
import type { Env } from "../config/env.js";
import { AppError } from "./errors.js";

export type AccessTokenPayload = {
  sub: string;
  roles: RoleType[];
  typ: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  typ: "refresh";
  jti: string;
};

function parseDurationToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Invalid TTL: ${ttl}`);
  }
  const amountRaw = match[1];
  const unit = match[2];
  if (amountRaw === undefined || unit === undefined) {
    throw new Error(`Invalid TTL: ${ttl}`);
  }
  const amount = Number.parseInt(amountRaw, 10);
  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 3600;
    case "d":
      return amount * 86400;
    default:
      throw new Error(`Invalid TTL unit: ${unit}`);
  }
}

export function parseAccessTtlSeconds(env: Env): number {
  return parseDurationToSeconds(env.JWT_ACCESS_TTL);
}

export function parseRefreshTtlSeconds(env: Env): number {
  return parseDurationToSeconds(env.JWT_REFRESH_TTL);
}

export function refreshExpiresAt(env: Env): Date {
  return new Date(Date.now() + parseRefreshTtlSeconds(env) * 1000);
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

function isRole(value: unknown): value is RoleType {
  return value === Role.ADMIN || value === Role.SELLER || value === Role.BUYER;
}

function parseRolesClaim(payload: JWTPayload): RoleType[] | null {
  const rolesRaw = payload["roles"];
  if (Array.isArray(rolesRaw) && rolesRaw.length > 0 && rolesRaw.every(isRole)) {
    return sortRoles(rolesRaw);
  }
  // Legacy single-role tokens (pre multi-role migration)
  const role = payload["role"];
  if (isRole(role)) {
    return [role];
  }
  return null;
}

export async function signAccessToken(
  env: Env,
  userId: string,
  roles: readonly RoleType[],
): Promise<string> {
  const normalized = sortRoles(roles);
  if (normalized.length === 0) {
    throw new Error("Access token requires at least one role");
  }
  return new SignJWT({ roles: normalized, typ: "access" } satisfies Omit<AccessTokenPayload, "sub">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(secretKey(env.JWT_ACCESS_SECRET));
}

export async function signRefreshJwt(
  env: Env,
  userId: string,
  jti: string,
): Promise<string> {
  return new SignJWT({ typ: "refresh", jti } satisfies Omit<RefreshTokenPayload, "sub">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(secretKey(env.JWT_REFRESH_SECRET));
}

export async function verifyAccessToken(env: Env, token: string): Promise<AccessTokenPayload> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, secretKey(env.JWT_ACCESS_SECRET));
    payload = result.payload;
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or expired access token");
  }

  const sub = payload.sub;
  const typ = payload["typ"];
  const roles = parseRolesClaim(payload);
  if (typeof sub !== "string" || !roles || typ !== "access") {
    throw new AppError(401, "UNAUTHORIZED", "Invalid access token payload");
  }
  return { sub, roles, typ: "access" };
}

export async function verifyRefreshJwt(env: Env, token: string): Promise<RefreshTokenPayload> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, secretKey(env.JWT_REFRESH_SECRET));
    payload = result.payload;
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or expired refresh token");
  }
  const sub = payload.sub;
  const typ = payload["typ"];
  const jti = payload["jti"];
  if (typeof sub !== "string" || typ !== "refresh" || typeof jti !== "string") {
    throw new AppError(401, "UNAUTHORIZED", "Invalid refresh token payload");
  }
  return { sub, typ: "refresh", jti };
}

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
