import assert from "node:assert/strict";
import test from "node:test";

import { invalidationSocketUrl, websocketProtocols } from "./invalidation";

test("a Bearer-prefixed session token is a legal WebSocket subprotocol", () => {
  assert.deepEqual(websocketProtocols("Bearer ABCDEFGHIJKLMNOP"), ["hb-auth", "ABCDEFGHIJKLMNOP"]);
  assert.deepEqual(websocketProtocols("bearer  ABCDEFGHIJKLMNOP"), ["hb-auth", "ABCDEFGHIJKLMNOP"]);
  assert.deepEqual(websocketProtocols("ABCDEFGHIJKLMNOP"), ["hb-auth", "ABCDEFGHIJKLMNOP"]);
});

test("a token with spaces is not offered as a subprotocol", () => {
  assert.equal(websocketProtocols("Bearer raw token"), undefined);
  assert.equal(websocketProtocols("   "), undefined);
});

test("the invalidation socket is tenant-scoped", () => {
  const url = new URL(invalidationSocketUrl("https://home.example", "group-1"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/api/v1/ws/events");
  assert.equal(url.searchParams.get("tenant"), "group-1");
});
