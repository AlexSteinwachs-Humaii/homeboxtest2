import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";

import { schema } from "./db/schema.ts";
import { StartupError } from "./errors.ts";

const UUID_TABLES = ["entities", "users", "groups"] as const;

export type UuidObservation = {
  table: (typeof UUID_TABLES)[number];
  observed: boolean;
  type: string | null;
  length: number | null;
};

// Stays false until a startup check has recorded typeof(id) and every observed
// value is a 16-byte blob. Story 2 must not map UUID columns unless this is true.
let mappingCommitted = false;
let drizzleAttached = false;

export function uuidMappingCommitted(): boolean {
  return mappingCommitted;
}

export function drizzleClientAttached(): boolean {
  return drizzleAttached;
}

export function resetUuidGateForTests(): void {
  mappingCommitted = false;
  drizzleAttached = false;
}

export function observeUuidColumn(db: Database, table: UuidObservation["table"]): UuidObservation {
  let row: { t: string | null; n: number | bigint | null } | null;
  try {
    row = db.query(`SELECT typeof(id) AS t, length(id) AS n FROM ${table} LIMIT 1`).get() as {
      t: string | null;
      n: number | bigint | null;
    } | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`cannot record typeof(id) on ${table}: ${message}`);
  }
  if (!row) {
    return { table, observed: false, type: null, length: null };
  }
  return {
    table,
    observed: true,
    type: row.t,
    length: row.n === null ? null : Number(row.n),
  };
}

export function formatUuidObservation(observation: UuidObservation): string {
  if (!observation.observed) {
    return `[homebox] uuid check ${observation.table}: no rows; typeof(id) not observed`;
  }
  return `[homebox] uuid check ${observation.table}: typeof(id)=${observation.type} length=${observation.length}`;
}

// Records typeof(id) before any Drizzle schema is attached. A non-blob id refuses
// startup and leaves the mapping uncommitted.
export function attachDatabase(db: Database): { orm: ReturnType<typeof drizzle>; observations: UuidObservation[] } {
  const observations = UUID_TABLES.map((table) => observeUuidColumn(db, table));
  for (const observation of observations) console.log(formatUuidObservation(observation));

  const bad = observations.filter(
    (observation) => observation.observed && (observation.type !== "blob" || observation.length !== 16),
  );
  if (bad.length > 0) {
    mappingCommitted = false;
    const detail = bad
      .map((observation) => `${observation.table}.id is ${observation.type} (length ${observation.length})`)
      .join("; ");
    throw new StartupError(
      `refusing to start: ${detail}; expected a 16-byte blob. UUID mapping will not be committed.`,
    );
  }

  mappingCommitted = true;
  const orm = drizzle(db, { schema });
  drizzleAttached = true;
  return { orm, observations };
}
