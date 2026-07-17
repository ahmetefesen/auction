import type { FastifyRequest } from "fastify";
import { uuidSchema } from "@auction/shared";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

/** Validates a UUID route param before the handler runs. */
export function requireUuidParam(param = "id") {
  return async (request: FastifyRequest<{ Params: Record<string, string> }>): Promise<void> => {
    const value = request.params[param];
    try {
      uuidSchema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(400, "INVALID_ID", `Invalid ${param}`);
      }
      throw error;
    }
  };
}
