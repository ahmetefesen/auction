import type { FastifyInstance } from "fastify";
import { prisma } from "@auction/db";
import { LoginSchema, RegisterSchema, UserStatus } from "@auction/shared";
import { REFRESH_COOKIE } from "../lib/auth-tokens.js";
import { AppError } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { AuthService } from "../services/auth.js";
import { assignRolesAndProfiles, toPublicUser } from "../lib/user-roles.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const auth = new AuthService(app.env);

  app.post("/auth/register", async (request, reply) => {
    const body = RegisterSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
    }
    const passwordHash = await auth.hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        status: UserStatus.ACTIVE,
        wallet: { create: {} },
      },
    });

    await assignRolesAndProfiles(user.id, body.roles);
    const withRoles = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roles: true },
    });

    await auth.establishSession(reply, {
      id: user.id,
      roles: withRoles.roles.map((r) => r.role),
    });

    void app.emailQueue.addWelcome({ userId: user.id, displayName: user.displayName }).catch((err) => {
      request.log.warn({ err }, "Failed to enqueue welcome email");
    });

    return { user: toPublicUser(withRoles) };
  });

  app.post("/auth/login", async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { roles: true },
    });
    if (!user || !(await auth.verifyPassword(user.passwordHash, body.password))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(403, "SUSPENDED", "Account suspended");
    }

    const roles = user.roles.map((r) => r.role);
    if (roles.length === 0) {
      throw new AppError(403, "FORBIDDEN", "User has no roles assigned");
    }

    await auth.establishSession(reply, { id: user.id, roles });

    return { user: toPublicUser(user) };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Missing refresh token");
    }
    await auth.rotateRefreshSession(reply, token);
    return { ok: true };
  });

  app.post("/auth/logout", async (request, reply) => {
    await auth.clearSession(reply, request.cookies[REFRESH_COOKIE]);
    return { ok: true };
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { wallet: true, roles: true },
    });
    return {
      user: toPublicUser(full),
      wallet: full.wallet
        ? {
            availableBalance: full.wallet.availableBalance,
            heldBalance: full.wallet.heldBalance,
          }
        : { availableBalance: 0, heldBalance: 0 },
    };
  });
}
