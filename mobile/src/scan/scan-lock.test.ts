import assert from "node:assert/strict";
import test from "node:test";
import { ScanLock } from "./scan-lock";

test("repeated camera frames do not erase a lookup result; scan again rearms it", () => {
  const lock = new ScanLock();
  assert.equal(lock.begin(true), true);
  assert.equal(lock.begin(true), false);
  assert.equal(lock.begin(false), false);
  lock.reset();
  lock.finish();
  assert.equal(lock.begin(true), false);
  assert.equal(lock.begin(false), true, "manual entry is still available after a camera result");
  lock.finish();
  assert.equal(lock.begin(true), false);
  lock.reset();
  assert.equal(lock.begin(true), true);
});
