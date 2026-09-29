import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { bullBoardRouter, bullBoardAdapter, BULL_BOARD_QUEUE_NAME } from "./bull-board.js";
import { emailQueue, EMAIL_QUEUE_NAME } from "./email.queue.js";
import { env } from "../config/env.js";

// Wiring only — no Redis here. Live dashboard rendering is environment-blocked.

// Importing email.queue opens its Redis connection (BullMQ connects eagerly),
// so close it afterwards. Without live Redis the shared client cannot fully
// stop reconnecting (BullMQ never closes user-supplied clients), hence
// --test-force-exit in the test script — results/exit codes are unaffected.
after(async () => {
  await emailQueue.close().catch(() => {});
});

describe("bull-board", () => {
  it("imports and exposes an Express router", () => {
    assert.equal(typeof bullBoardRouter, "function");
  });
  it("observes the existing email-send queue (same name, unchanged)", () => {
    assert.equal(BULL_BOARD_QUEUE_NAME, "email-send");
    assert.equal(EMAIL_QUEUE_NAME, "email-send");
    assert.equal(emailQueue.name, "email-send");
  });
  it("adapter wraps that same queue instance", () => {
    assert.equal(bullBoardAdapter.getName(), emailQueue.name);
  });
  it("dashboard is enabled by default (dev-only, documented)", () => {
    assert.equal(env.BULL_BOARD_ENABLED, true);
  });
});
