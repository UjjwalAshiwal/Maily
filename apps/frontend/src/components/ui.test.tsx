import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { EmptyState, ErrorState, StatusBadge } from "./ui";

// Server-rendered assertions: verify the states produce the right copy and
// roles without needing a browser runner.

describe("states", () => {
  it("empty scheduled/sent state renders title, hint, and next action", () => {
    const html = renderToString(
      createElement(EmptyState, {
        title: "No scheduled emails",
        hint: "Nothing is queued.",
        action: createElement("span", null, "Schedule email"),
      })
    );
    assert.match(html, /No scheduled emails/);
    assert.match(html, /Nothing is queued/);
    assert.match(html, /Schedule email/);
  });

  it("error state renders the message with a retry action", () => {
    const html = renderToString(
      createElement(ErrorState, { message: "Search is unavailable", onRetry: () => {} })
    );
    assert.match(html, /Something went wrong/);
    assert.match(html, /Search is unavailable/);
    assert.match(html, /Try again/);
  });

  it("status badge never relies on color alone (text label present)", () => {
    for (const status of ["SCHEDULED", "PROCESSING", "SENT", "FAILED"]) {
      assert.match(renderToString(createElement(StatusBadge, { status })), new RegExp(status));
    }
  });
});
