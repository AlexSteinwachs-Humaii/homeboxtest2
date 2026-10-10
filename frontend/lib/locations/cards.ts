import type { EntitySummary, TreeItem } from "../api/types/data-contracts";

/** Parent cards use direct location children, not item names or deeper descendants. */
export function locationCards(parents: EntitySummary[], tree: TreeItem[], search: string) {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const nestedNames = new Map<string, string[]>();
  function visit(nodes: TreeItem[]) {
    for (const node of nodes) {
      if (node.type === "location") {
        nestedNames.set(
          node.id,
          node.children
            .filter(child => child.type === "location")
            .map(child => child.name)
            .sort(collator.compare)
        );
      }
      visit(node.children);
    }
  }
  visit(tree);
  const query = search.trim().toLocaleLowerCase();
  return parents
    .filter(location => location.name.toLocaleLowerCase().includes(query))
    .map(location => ({
      location,
      nestedNames: nestedNames.get(location.id) ?? [],
    }))
    .sort((a, b) => collator.compare(a.location.name, b.location.name));
}
