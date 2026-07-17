import type { FastifyReply } from "fastify";
import type { Role } from "@auction/shared";
import { UserStatus } from "@auction/shared";
import { prisma } from "@auction/db";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  generateRefreshToken,
  hashPassword,
  hashToken,
  refreshExpiresAt,
  signAccessToken,
  signRefreshJwt,
  verifyPassword,
  verifyRefreshJwt,
  parseAccessTtlSeconds,
  parseRefreshTtlSeconds,
} from "../lib/auth-tokens.js";

function cookieOpts(secure: boolean, maxAgeSec: number) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: string;
  createdAt: Date;
};

/**
 * Auth Service — Argon2id passwords, JWT access + refresh in httpOnly cookies.
 */
export class AuthService {
  constructor(private readonly env: Env) {}

  hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  verifyPassword(hash: string, password: string): Promise<boolean> {
    return verifyPassword(hash, password);
  }

  /** Issue access + refresh JWTs, persist refresh hash, set httpOnly cookies. */
  async establishSession(
    reply: FastifyReply,
    user: { id: string; role: Role },
  ): Promise<void> {
    const access = await signAccessToken(this.env, user.id, user.role);
    const rawRefresh = generateRefreshToken();
    const tokenHash = hashToken(rawRefresh);
    const refreshJwt = await signRefreshJwt(this.env, user.id, tokenHash);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: refreshExpiresAt(this.env),
      },
    });

    reply
      .setCookie(
        ACCESS_COOKIE,
        access,
        cookieOpts(this.env.COOKIE_SECURE, parseAccessTtlSeconds(this.env)),
      )
      .setCookie(
        REFRESH_COOKIE,
        refreshJwt,
        cookieOpts(this.env.COOKIE_SECURE, parseRefreshTtlSeconds(this.env)),
      );
  }

  async rotateRefreshSession(reply: FastifyReply, refreshCookie: string): Promise<SessionUser> {
    const payload = await verifyRefreshJwt(this.env, refreshCookie);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: payload.jti } });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, "UNAUTHORIZED", "Refresh token revoked or expired");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppError(401, "UNAUTHORIZED", "User inactive");
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    await this.establishSession(reply, { id: user.id, role: user.role });
    return user;
  }

  async clearSession(reply: FastifyReply, refreshCookie: string | undefined): Promise<void> {
    if (refreshCookie) {
      try {
        const payload = await verifyRefreshJwt(this.env, refreshCookie);
        await prisma.refreshToken.updateMany({
          where: { tokenHash: payload.jti, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch {
        // ignore invalid refresh on logout
      }
    }
    reply.clearCookie(ACCESS_COOKIE, { path: "/" }).clearCookie(REFRESH_COOKIE, { path: "/" });
  }
}
