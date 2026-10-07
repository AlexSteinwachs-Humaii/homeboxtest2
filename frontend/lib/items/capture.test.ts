import { describe, expect, test } from "vitest";
import type { EntityOut } from "../api/types/data-contracts";
import { captureDetailsUpdate } from "./capture";

describe("capture follow-up details", () => {
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
    const update = captureDetailsUpdate(item, { purchasePrice: 89 }, "fallback");
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
    const update = captureDetailsUpdate({ tags: [] } as unknown as EntityOut, { purchasePrice: 0 }, "type");
    expect(update.purchasePrice).toBe(0);
    expect(update.entityTypeId).toBe("type");
    expect(update.parentId).toBeNull();
    expect(update.tagIds).toEqual([]);
  });

  test("saves serial and insurance without overwriting price, model, manufacturer or parent", () => {
    const item = {
      tags: [{ id: "tag" }],
      parent: { id: "parent-item" },
      purchasePrice: 42,
      manufacturer: "Acme",
      modelNumber: "M1",
      serialNumber: "",
      insured: false,
    } as EntityOut;
    const update = captureDetailsUpdate(item, { serialNumber: "S1", insured: true }, "type");
    expect(update).toMatchObject({
      purchasePrice: 42,
      manufacturer: "Acme",
      modelNumber: "M1",
      parentId: "parent-item",
      tagIds: ["tag"],
      serialNumber: "S1",
      insured: true,
    });
    expect(item.insured).toBe(false);
  });
});
