import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRecipients } from "./csv";

describe("parseCsvRecipients", () => {
  it("parses a header-based email column", () => {
    const r = parseCsvRecipients("email\na@example.com\nb@example.com");
    assert.deepEqual(r.validEmails, ["a@example.com", "b@example.com"]);
    assert.deepEqual(r.invalidRows, []);
  });
  it("accepts headerless single-column files", () => {
    const r = parseCsvRecipients("a@example.com\nb@example.com");
    assert.deepEqual(r.validEmails, ["a@example.com", "b@example.com"]);
  });
  it("flags invalid rows and trims whitespace", () => {
    const r = parseCsvRecipients("email\n  good@example.com  \nnot-an-email");
    assert.deepEqual(r.validEmails, ["good@example.com"]);
    assert.equal(r.invalidRows.length, 1);
  });
  it("drops duplicates", () => {
    const r = parseCsvRecipients("email\na@example.com\na@example.com");
    assert.deepEqual(r.validEmails, ["a@example.com"]);
  });
  it("keeps quoted commas in one field and handles empty input", () => {
    const r = parseCsvRecipients('email\n"a,b"@example.com');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].email, "a,b@example.com");
    assert.deepEqual(parseCsvRecipients("  \n "), { rows: [], validEmails: [], invalidRows: [] });
  });
  it("reads non-first email columns", () => {
    const r = parseCsvRecipients("name,email\nAnn,a@example.com");
    assert.deepEqual(r.validEmails, ["a@example.com"]);
  });
});
