import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, defaultStartTime, validateCompose } from "./compose";

const NOW = new Date("2026-09-29T12:00:00Z").getTime();
const FUTURE = new Date(NOW + 3600_000).toISOString();

describe("validateCompose", () => {
  it("accepts a complete future-dated email", () => {
    assert.deepEqual(
      validateCompose(
        { senderId: "s1", recipient: "to@example.com", subject: "Hi", body: "Hello", scheduledAt: FUTURE },
        NOW
      ),
      {}
    );
  });
  it("rejects missing fields", () => {
    const errs = validateCompose(
      { senderId: "", recipient: "bad", subject: "", body: "", scheduledAt: "" },
      NOW
    );
    assert.ok(errs.senderId && errs.recipient && errs.subject && errs.body && errs.scheduledAt);
  });
  it("rejects past start times", () => {
    const errs = validateCompose(
      { senderId: "s1", recipient: "to@example.com", subject: "Hi", body: "Hello", scheduledAt: "2026-09-29T11:00" },
      NOW
    );
    assert.match(errs.scheduledAt!, /future/);
  });
});

describe("defaultStartTime", () => {
  it("returns a future datetime-local value", () => {
    const v = defaultStartTime(NOW);
    assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.ok(new Date(v).getTime() > NOW);
  });
});

describe("computeSchedule", () => {
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 8, 29, 10, 0, 0);
  it("spaces recipients by the delay", () => {
    assert.deepEqual(computeSchedule(3, start, 2000, 200), [start, start + 2000, start + 4000]);
  });
  it("spills hours past the hourly cap into the next hour", () => {
    const times = computeSchedule(3, start + HOUR - 1000, 2000, 2);
    assert.equal(times[0], start + HOUR - 1000);
    assert.equal(times[1], start + HOUR - 1000 + 2000);
    assert.ok(times[2] >= start + HOUR && times[2] <= start + 2 * HOUR);
  });
  it("empty input schedules nothing", () => {
    assert.deepEqual(computeSchedule(0, start, 2000, 200), []);
  });
});
