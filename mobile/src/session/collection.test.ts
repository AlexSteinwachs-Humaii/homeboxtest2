import assert from "node:assert/strict";
import test from "node:test";

import { readPreferredCollection, writePreferredCollection } from "./collection";

test("the preferred collection is an id, not an inventory copy", () => {
  const saved = new Map<string, string>();
  const box = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
    clear: () => saved.clear(),
    key: () => null,
    length: 0,
  };
  const scope = globalThis as { localStorage?: Storage };
  const prior = scope.localStorage;
  scope.localStorage = box as Storage;
  try {
    assert.equal(readPreferredCollection(), "");
    writePreferredCollection("  22222222-2222-4222-8222-222222222222  ");
    assert.equal(readPreferredCollection(), "22222222-2222-4222-8222-222222222222");
    assert.equal(saved.get("homebox.collection"), "22222222-2222-4222-8222-222222222222");
    writePreferredCollection("");
    assert.equal(readPreferredCollection(), "");
    assert.equal([...saved.keys()].some((key) => key.includes("homebox.db")), false);
  } finally {
    if (prior === undefined) delete scope.localStorage;
    else scope.localStorage = prior;
  }
});
