import { describe, expect, it } from "vitest";
import type { EntitySummary, TreeItem } from "../api/types/data-contracts";
import { locationCards } from "./cards";

const place = (id: string, name: string, itemCount?: number) => ({ id, name, itemCount }) as EntitySummary;
const node = (id: string, name: string, children: TreeItem[] = [], type = "location"): TreeItem => ({
  id,
  name,
  children,
  type,
});
const parents = [place("garage", "Garage", 2), place("box", "Box")];
const tree = [
  node("garage", "Garage", [
    node("shelf", "Tool Shelf", [node("bin", "Small bin")]),
    node("storage", "Storage shelf"),
    node("drill", "Drill", [], "item"),
  ]),
  node("box", "Box"),
];

describe("parent location cards", () => {
  it("lists only supplied parent locations with direct location summaries and unchanged item counts", () => {
    const cards = locationCards(parents, tree, "");
    expect(cards.map(card => card.location.name)).toEqual(["Box", "Garage"]);
    expect(cards[1]!.nestedNames).toEqual(["Storage shelf", "Tool Shelf"]);
    expect(cards[1]!.location.itemCount).toBe(2);
    expect(cards[0]!.nestedNames).toEqual([]);
    expect(cards[0]!.location.itemCount ?? 0).toBe(0);
  });

  it("searches parent names case-insensitively and ignores surrounding whitespace", () => {
    expect(locationCards(parents, tree, "  GAR  ").map(card => card.location.id)).toEqual(["garage"]);
    expect(locationCards(parents, tree, "Tool Shelf")).toEqual([]);
    expect(locationCards(parents, tree, "missing")).toEqual([]);
  });

  it("matches summaries by id, not name, and supports parents without a tree node", () => {
    expect(locationCards([place("other", "Garage")], tree, "")[0]!.nestedNames).toEqual([]);
    expect(locationCards([], tree, "")).toEqual([]);
  });
});
