import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isProcessingRecovery } from "./processing-recovery.js";

// Guards the PROCESSING crash-recovery fix: a PROCESSING row must be
// reprocessed when (and only when) this job execution is a BullMQ
// retry or stall recovery of the same stable job.
describe("isProcessingRecovery", () => {
  it("skips: first delivery is not a recovery", () => {
    assert.equal(isProcessingRecovery({ attemptsMade: 0, stalledCounter: 0 }), false);
  });
  it("skips: missing stalledCounter still decides on attempts", () => {
    assert.equal(isProcessingRecovery({ attemptsMade: 0 }), false);
    assert.equal(isProcessingRecovery({ attemptsMade: 0, stalledCounter: null }), false);
  });
  it("recovers: BullMQ retry after a failed attempt", () => {
    assert.equal(isProcessingRecovery({ attemptsMade: 1, stalledCounter: 0 }), true);
    assert.equal(isProcessingRecovery({ attemptsMade: 2 }), true);
  });
  it("recovers: stall recovery after a crash (lock expired, attempts untouched)", () => {
    assert.equal(isProcessingRecovery({ attemptsMade: 0, stalledCounter: 1 }), true);
  });
  it("recovers: retry of a previously stalled job", () => {
    assert.equal(isProcessingRecovery({ attemptsMade: 1, stalledCounter: 1 }), true);
  });
});
