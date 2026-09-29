import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SEARCH_RESPONSE, searchEmails, toSearchResponse } from "./search.service.js";

// No live Elasticsearch here — rule parsing and shape only.
describe("searchEmails input rules", () => {
  it("empty query never touches the index", async () => {
    assert.deepEqual(await searchEmails({ q: "  " }), EMPTY_SEARCH_RESPONSE);
    assert.deepEqual(await searchEmails({}), EMPTY_SEARCH_RESPONSE);
  });
  it("rejects unknown status filters", async () => {
    await assert.rejects(() => searchEmails({ q: "x", status: "NOPE" }), /invalid status filter/);
  });
  it("an explicitly empty sender list short-circuits", async () => {
    assert.deepEqual(await searchEmails({ q: "x", senderIds: [] }), EMPTY_SEARCH_RESPONSE);
  });
});

describe("toSearchResponse", () => {
  it("exposes only the public shape, no ES internals", () => {
    const res = toSearchResponse(
      [
        {
          id: "e1",
          senderId: "s1",
          recipient: "john@example.com",
          subject: "Hello",
          body: "secret body",
          status: "SENT",
          scheduledAt: "2026-09-29T15:00:00.000Z",
          sentAt: "2026-09-29T15:00:01.000Z",
          createdAt: "2026-09-29T14:00:00.000Z",
          updatedAt: "2026-09-29T15:00:01.000Z",
        },
      ],
      1
    );
    assert.deepEqual(res, {
      results: [
        {
          id: "e1",
          senderId: "s1",
          recipient: "john@example.com",
          subject: "Hello",
          body: "secret body",
          status: "SENT",
          scheduledAt: "2026-09-29T15:00:00.000Z",
          sentAt: "2026-09-29T15:00:01.000Z",
        },
      ],
      total: 1,
    });
  });
});
