import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hourWindowFor,
  nextHourStartMs,
  nextSendKey,
  hourCounterKey,
  emailSlotKey,
} from "./rate-limit.service.js";

// Pure coordination helpers only — Redis atomicity tests need live Redis
// (recorded as environment-blocked in PROJECT_MEMORY.md).

describe("hourWindowFor", () => {
  it("formats a UTC hour window deterministically", () => {
    assert.equal(hourWindowFor(Date.UTC(2026, 8, 29, 15, 30)), "2026092915");
  });
  it("uses UTC, not local time", () => {
    // 2026-09-29T00:30+05:30 local == 2026-09-28T19:00Z
    const ms = Date.UTC(2026, 8, 28, 19, 0);
    assert.equal(hourWindowFor(ms), "2026092819");
  });
  it("rolls the window at the hour boundary", () => {
    assert.equal(hourWindowFor(Date.UTC(2026, 8, 29, 15, 59, 59)), "2026092915");
    assert.equal(hourWindowFor(Date.UTC(2026, 8, 29, 16, 0, 0)), "2026092916");
  });
});

describe("nextHourStartMs", () => {
  it("returns the top of the next UTC hour", () => {
    assert.equal(nextHourStartMs(Date.UTC(2026, 8, 29, 15, 20)), Date.UTC(2026, 8, 29, 16, 0));
  });
});

describe("key design", () => {
  it("scopes minimum-delay slots by sender", () => {
    assert.equal(nextSendKey("a"), "rl:sender:a:next");
    assert.notEqual(nextSendKey("a"), nextSendKey("b"));
  });
  it("scopes hourly counters by sender AND window", () => {
    assert.equal(hourCounterKey("a", "2026092915"), "rl:sender:a:hour:2026092915");
    assert.notEqual(hourCounterKey("a", "2026092915"), hourCounterKey("b", "2026092915"));
    assert.notEqual(hourCounterKey("a", "2026092915"), hourCounterKey("a", "2026092916"));
  });
  it("scopes reserve-once slots by email", () => {
    assert.equal(emailSlotKey("e1"), "rl:email:e1:slot");
    assert.notEqual(emailSlotKey("e1"), emailSlotKey("e2"));
  });
});
