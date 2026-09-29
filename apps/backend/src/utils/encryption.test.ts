import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "./encryption.js";

describe("encryption", () => {
  it("round-trips a webhook URL", () => {
    const url = "https://hooks.slack.com/services/T/B/X";
    assert.equal(decrypt(encrypt(url)), url);
  });
  it("uses a random IV per encryption", () => {
    assert.notEqual(encrypt("same"), encrypt("same"));
  });
  it("rejects the wrong key", () => {
    const packed = encrypt("secret");
    assert.throws(() => decrypt(packed.slice(0, -2) + "ff"));
  });
  it("rejects tampered and malformed ciphertext", () => {
    assert.throws(() => decrypt("not-a-ciphertext"));
    assert.throws(() => decrypt("a:b:c:d"));
  });
});
