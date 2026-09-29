import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseListParams } from "./email.service.js";

// Pure param parsing only — list queries need live Postgres (blocked here).
describe("parseListParams", () => {
  it("defaults page and limit", () => {
    assert.deepEqual(parseListParams({}), { status: undefined, page: 1, limit: 20 });
  });
  it("accepts known statuses", () => {
    assert.equal(parseListParams({ status: "SENT" }).status, "SENT");
  });
  it("rejects unknown statuses", () => {
    assert.throws(() => parseListParams({ status: "NOPE" }), /invalid status filter/);
    assert.throws(() => parseListParams({ status: "NOPE" }));
  });
  it("clamps limit to the maximum", () => {
    assert.equal(parseListParams({ limit: 500 }).limit, 100);
    assert.equal(parseListParams({ page: -3 }).page, 1);
  });
});
