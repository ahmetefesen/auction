import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { Role, hasAnyRole, auctionRoom, userRoom, sellerRoom } from "@auction/shared";
import type { Env } from "../config/env.js";
import { verifyAccessToken, ACCESS_COOKIE } from "../lib/auth-tokens.js";

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

export async function createSocketServer(
  httpServer: HttpServer,
  env: Env,
): Promise<{ io: Server; pubClient: Redis; subClient: Redis }> {
  const pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();

  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  io.adapter(createAdapter(pubClient, subClient));

  /** Optional auth: guests may connect for read-only auction rooms. */
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookieHeader(socket.request.headers.cookie);
      const token = cookies[ACCESS_COOKIE];
      if (!token) {
        socket.data.userId = null;
        socket.data.roles = null;
        next();
        return;
      }
      const payload = await verifyAccessToken(env, token);
      socket.data.userId = payload.sub;
      socket.data.roles = payload.roles;
      next();
    } catch {
      // Invalid token — still allow guest connection
      socket.data.userId = null;
      socket.data.roles = null;
      next();
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const roles = socket.data.roles as import("@auction/shared").Role[] | null;
    if (typeof userId === "string") {
      void socket.join(userRoom(userId));
      // Sellers (and admins) receive bid.placed on their desk via seller:{id}
      if (Array.isArray(roles) && hasAnyRole(roles, Role.SELLER, Role.ADMIN)) {
        void socket.join(sellerRoom(userId));
      }
    }

    socket.on("auction:join", (auctionId: unknown) => {
      if (typeof auctionId !== "string") return;
      void socket.join(auctionRoom(auctionId));
    });

    socket.on("auction:leave", (auctionId: unknown) => {
      if (typeof auctionId !== "string") return;
      void socket.leave(auctionRoom(auctionId));
    });
  });

  return { io, pubClient, subClient };
}
