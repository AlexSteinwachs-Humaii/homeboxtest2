import type { Database } from "bun:sqlite";

import { listEntities, type EntityRow } from "../db/inventory.ts";
import { searchEntities } from "../search/entities.ts";
import { idPair, readUuid } from "./ids.ts";
import { presentSummary } from "./present.ts";

export type EntityList = {
  items: ReturnType<typeof presentSummary>[];
  page: number;
  pageSize: number;
  total: number;
  totalPrice: number;
};

function flag(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  return value === "1" || value === "true" || value === "t";
}

function photoIds(db: Database, groupId: string): Set<string> {
  const [bytes, text] = idPair(groupId);
  const rows = db
    .query(
      `SELECT a.entity_attachments AS entity_id FROM attachments a
       JOIN entities e ON e.id = a.entity_attachments
       WHERE a.type = 'photo' AND (e.group_entities = ? OR e.group_entities = ?)`,
    )
    .all(bytes, text) as Array<{ entity_id: unknown }>;
  return new Set(rows.map((row) => readUuid(row.entity_id)).filter((id): id is string => Boolean(id)));
}

function tagLinks(db: Database, entityId: string): string[] {
  const [bytes, text] = idPair(entityId);
  const rows = db.query(`SELECT tag_id FROM tag_entities WHERE entity_id = ? OR entity_id = ?`).all(bytes, text) as Array<{
    tag_id: unknown;
  }>;
  return rows.map((row) => readUuid(row.tag_id)).filter((id): id is string => Boolean(id));
}

export function queryEntityList(db: Database, groupId: string, params: URLSearchParams): EntityList {
  const isLocation = flag(params.get("isLocation") ?? params.get("location"));
  const search = params.get("q") ?? "";
  let rows = search
    ? searchEntities(db, { groupId, isLocation: isLocation ?? false, search })
    : listEntities(db, { groupId, isLocation: isLocation ?? false });
  if (params.get("includeArchived") !== "true") rows = rows.filter((row) => row.archived !== 1);
  if (params.get("filterChildren") === "true") rows = rows.filter((row) => !row.parentId);
  const parents = params.getAll("parentIds").filter(Boolean);
  if (parents.length > 0) rows = rows.filter((row) => row.parentId && parents.includes(row.parentId));
  const tags = params.getAll("tags").filter(Boolean);
  if (tags.length > 0) {
    const negate = params.get("negateTags") === "true";
    rows = rows.filter((row) => {
      const linked = tagLinks(db, row.id);
      const hit = tags.some((tag) => linked.includes(tag));
      return negate ? !hit : hit;
    });
  }
  if (params.get("onlyWithPhoto") === "true" || params.get("onlyWithoutPhoto") === "true") {
    const photos = photoIds(db, groupId);
    const want = params.get("onlyWithPhoto") === "true";
    rows = rows.filter((row) => photos.has(row.id) === want);
  }
  const order = params.get("orderBy") ?? "name";
  rows = [...rows].sort((a, b) => compare(a, b, order));
  const total = rows.length;
  const pageRaw = params.get("page");
  const sizeRaw = params.get("pageSize");
  const page = pageRaw ? Number(pageRaw) : -1;
  const pageSize = sizeRaw ? Number(sizeRaw) : -1;
  let window = rows;
  if (page !== -1 || pageSize !== -1) {
    const size = pageSize > 0 ? pageSize : rows.length;
    const start = Math.max(0, (Math.max(page, 1) - 1) * size);
    window = rows.slice(start, start + size);
  }
  const items = window.map((row) => presentSummary(db, row));
  const totalPrice = rows.reduce((sum, row) => (row.soldDate ? sum : sum + Math.round(row.purchasePrice * 100) / 100 * row.quantity), 0);
  return { items, page, pageSize, total, totalPrice };
}

function compare(a: EntityRow, b: EntityRow, order: string): number {
  if (order === "createdAt") return b.createdAt.localeCompare(a.createdAt);
  if (order === "updatedAt") return b.updatedAt.localeCompare(a.updatedAt);
  if (order === "assetId") return a.assetId - b.assetId;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
