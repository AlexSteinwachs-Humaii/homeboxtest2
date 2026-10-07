import { describe, expect, test } from "vitest";
import type { EntityOut } from "../api/types/data-contracts";
import { capturePriceUpdate } from "./capture";

describe("capture purchase price", () => {
  test("preserves the record and translates response edges to update IDs", () => {
    const item = {
      id: "item",
      name: "Sleeping bag",
      quantity: 2,
      description: "Blue sack",
      parent: { id: "closet" },
      entityType: { id: "type" },
      tags: [{ id: "camping" }],
      purchasePrice: 0,
      insured: false,
      archived: false,
      serialNumber: "serial",
      fields: [{ id: "field", textValue: "keep" }],
      notes: "keep notes",
    } as EntityOut;
    const update = capturePriceUpdate(item, 89, "fallback");
    expect(update).toMatchObject({
      id: "item",
      name: "Sleeping bag",
      quantity: 2,
      description: "Blue sack",
      parentId: "closet",
      entityTypeId: "type",
      tagIds: ["camping"],
      purchasePrice: 89,
      serialNumber: "serial",
      fields: item.fields,
      notes: "keep notes",
    });
    expect(item.purchasePrice).toBe(0);
  });

  test("accepts a zero price and a response without optional edges", () => {
    const update = capturePriceUpdate({ tags: [] } as unknown as EntityOut, 0, "type");
    expect(update.purchasePrice).toBe(0);
    expect(update.entityTypeId).toBe("type");
    expect(update.parentId).toBeNull();
    expect(update.tagIds).toEqual([]);
  });
});
