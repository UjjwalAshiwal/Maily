import { PrismaClient } from "@prisma/client";

// Reused across tsx-watch reloads so dev doesn't exhaust the PG pool.
export const prisma =
  (globalThis as { __prisma?: PrismaClient }).__prisma ?? new PrismaClient();
if (!(globalThis as { __prisma?: PrismaClient }).__prisma)
  (globalThis as { __prisma?: PrismaClient }).__prisma = prisma;
