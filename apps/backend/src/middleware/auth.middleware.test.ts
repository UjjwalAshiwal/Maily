import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "./auth.middleware.js";

// Pre-database paths only — a live user lookup needs Dockerized Postgres
// (recorded as environment-blocked in PROJECT_MEMORY.md).
const run = (headers: Record<string, string>) =>
  new Promise<{ status?: number }>((resolve) => {
    requireAuth(
      { headers } as never,
      {} as never,
      ((e?: { status?: number }) => resolve(e ?? {})) as never
    );
  });

describe("requireAuth", () => {
  it("rejects requests with no credentials", async () => {
    assert.equal((await run({})).status, 401);
  });
  it("rejects malformed tokens without touching the database", async () => {
    assert.equal((await run({ authorization: "Bearer garbage" })).status, 401);
  });
});
