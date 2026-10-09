import type { Database } from "bun:sqlite";

import { listEntities, requireGroupId, type EntityFilter, type EntityRow } from "../db/inventory.ts";
import { normalizeSearchQuery } from "./normalize.ts";

// Same columns EntityRepository.QueryByGroup compares with ContainsFold.
const SEARCH_FIELDS = ["name", "description", "serialNumber", "modelNumber", "manufacturer", "notes"] as const;

function containsFold(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// Match the original case-insensitive contains and the accent-normalized
// contains. Comparing normalized forms both ways is what makes an unaccented
// query find an accented item, and the reverse.
export function entityMatchesSearch(entity: Pick<EntityRow, (typeof SEARCH_FIELDS)[number]>, query: string): boolean {
  const normalizedQuery = normalizeSearchQuery(query);
  for (const field of SEARCH_FIELDS) {
    const value = entity[field];
    if (!value) continue;
    if (containsFold(value, query)) return true;
    if (normalizedQuery !== "" && normalizeSearchQuery(value).includes(normalizedQuery)) return true;
  }
  return false;
}

// ParseAssetID: digits, ignoring quotes and hyphens. Nil (≤ 0) is not a filter.
function parseAssetId(raw: string): number | null {
  const digits = raw.replaceAll('"', "").replaceAll("-", "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function searchEntities(db: Database, filter: EntityFilter & { search: string }): EntityRow[] {
  const groupId = requireGroupId(filter.groupId);
  const rows = listEntities(db, { groupId, isLocation: filter.isLocation });
  const search = filter.search;
  if (search.startsWith("#")) {
    const assetId = parseAssetId(search.slice(1));
    if (assetId !== null) return rows.filter((row) => row.assetId === assetId);
  }
  if (search === "") return rows;
  return rows.filter((row) => entityMatchesSearch(row, search));
}
