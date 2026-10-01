import { PrismaClient } from "@prisma/client";

// ponytail: reuse across tsx-watch reloads instead of exhausting PG pool
export const prisma =
  (globalThis as { __prisma?: PrismaClient }).__prisma ?? new PrismaClient();
if (!(globalThis as { __prisma?: PrismaClient }).__prisma)
  (globalThis as { __prisma?: PrismaClient }).__prisma = prisma;
