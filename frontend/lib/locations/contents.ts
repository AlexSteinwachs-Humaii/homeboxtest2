import type { EntitySummary } from "../api/types/data-contracts";

/**
 * Parent ids for the items on a location page.
 * Null until the loaded location matches the route, so a navigation cannot
 * query the previous place and then skip the refetch when the child set
 * looks unchanged.
 */
export function locationItemParentIds(
  location: { id: string; children?: { id: string }[] } | null | undefined,
  routeId: string
): string[] | null {
  if (!location || location.id !== routeId) {
    return null;
  }
  return [location.id, ...(location.children ?? []).map(child => child.id)];
}

/**
 * Direct item quantity for a nested place.
 * The location detail payload's children omit itemCount (it is filled only on
 * the locations list). A missing list entry is not the same as zero.
 */
export function nestedLocationItemCount(
  childId: string,
  knownLocations: EntitySummary[],
  items: { parent?: { id?: string } | null; quantity?: number }[] | null,
  locationReady: boolean
): number | null {
  const stored = knownLocations.find(location => location.id === childId);
  if (stored) {
    return stored.itemCount ?? 0;
  }
  if (!locationReady || !items) {
    return null;
  }
  return items
    .filter(item => item.parent?.id === childId)
    .reduce((total, item) => total + (Number(item.quantity) || 0), 0);
}
