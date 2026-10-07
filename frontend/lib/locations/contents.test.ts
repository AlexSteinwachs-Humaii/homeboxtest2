import { describe, expect, it } from "vitest";
import type { EntitySummary } from "../api/types/data-contracts";
import { locationItemParentIds, nestedLocationItemCount } from "./contents";

const place = (id: string, itemCount?: number) => ({ id, name: id, itemCount }) as EntitySummary;

describe("location contents helpers", () => {
  it("waits for the loaded location before querying items", () => {
    expect(locationItemParentIds(undefined, "garage")).toBeNull();
    expect(locationItemParentIds({ id: "garage", children: [{ id: "shelf" }] }, "shelf")).toBeNull();
    expect(locationItemParentIds({ id: "shelf", children: [] }, "shelf")).toEqual(["shelf"]);
    expect(locationItemParentIds({ id: "garage", children: [{ id: "shelf" }] }, "garage")).toEqual(["garage", "shelf"]);
  });

  it("does not treat a missing detail count as zero", () => {
    expect(nestedLocationItemCount("shelf", [], null, false)).toBeNull();
    expect(nestedLocationItemCount("shelf", [place("shelf", 6)], null, false)).toBe(6);
    expect(nestedLocationItemCount("shelf", [place("shelf")], null, true)).toBe(0);
    expect(
      nestedLocationItemCount(
        "shelf",
        [],
        [
          { parent: { id: "shelf" }, quantity: 2 },
          { parent: { id: "garage" }, quantity: 1 },
        ],
        true
      )
    ).toBe(2);
  });
});
