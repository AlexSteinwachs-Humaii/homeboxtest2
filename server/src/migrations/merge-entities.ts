import type { Database } from "bun:sqlite";

import { StartupError } from "../errors.ts";

// Port of backend/internal/data/migrations/sqlite3/20260416120001_merge_entities.go.
// The Go function is named Up20260402120001; Goose versions it from the filename.
const UUID_EXPR =
  "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))";

export function mergeEntities(db: Database): void {
  try {
    exec(db, "PRAGMA foreign_keys=OFF", "disable FK");
    createEntityTypes(db);
    createEntitiesTable(db);
    migrateData(db);
    recreateDependentTables(db);
    recreateIndexes(db);
    exec(db, "PRAGMA foreign_keys=ON", "re-enable FK");
  } catch (err) {
    if (err instanceof StartupError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`failed to apply goose migration 20260416120001 (merge_entities): ${message}`);
  }
}

function exec(db: Database, sql: string, step: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`merge_entities: ${step}: ${message}`);
  }
}

function createEntityTypes(db: Database): void {
  exec(
    db,
    `
      CREATE TABLE IF NOT EXISTS entity_types (
        id               uuid     not null primary key,
        created_at       datetime not null,
        updated_at       datetime not null,
        name             text     not null,
        description      text,
        is_location      bool     default false not null,
        icon             text,
        group_entity_types uuid   not null
          constraint entity_types_groups_entity_types
            references groups
            on delete cascade
      );
    `,
    "create entity_types",
  );

  const seed = `INSERT INTO entity_types (id, created_at, updated_at, name, description, is_location, group_entity_types)
    SELECT ${UUID_EXPR}, datetime('now'), datetime('now'), ?, '', ?, g.id FROM groups g`;
  try {
    db.run(seed, ["global.location", 1]);
    db.run(seed, ["global.item", 0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`merge_entities: seed entity types: ${message}`);
  }
}

function createEntitiesTable(db: Database): void {
  exec(
    db,
    `
      CREATE TEMP TABLE _location_mapping AS
      SELECT id, location_items FROM items WHERE location_items IS NOT NULL AND item_children IS NULL;
    `,
    "save location mapping",
  );

  exec(
    db,
    `
      CREATE TABLE entities (
        id                          uuid                  not null primary key,
        created_at                  datetime              not null,
        updated_at                  datetime              not null,
        name                        text                  not null,
        description                 text,
        import_ref                  text,
        notes                       text,
        quantity                    real    default 1     not null,
        insured                     bool    default false not null,
        archived                    bool    default false not null,
        asset_id                    bigint  default 0     not null,
        sync_child_entity_locations bool    default false not null,
        serial_number               text,
        model_number                text,
        manufacturer                text,
        lifetime_warranty           bool    default false not null,
        warranty_expires            datetime,
        warranty_details            text,
        purchase_time               datetime,
        purchase_from               text,
        purchase_price              real    default 0     not null,
        sold_time                   datetime,
        sold_to                     text,
        sold_price                  real    default 0     not null,
        sold_notes                  text,
        group_entities              uuid                  not null
          constraint entities_groups_entities
            references groups
            on delete cascade,
        entity_type_entities        uuid                  not null
          constraint entities_entity_types_entities
            references entity_types
            on delete restrict,
        entity_children             uuid
          constraint entities_entities_children
            references entities
            on delete set null
      );
    `,
    "create entities table",
  );
}

function migrateData(db: Database): void {
  exec(
    db,
    `
      INSERT INTO entities (
        id, created_at, updated_at, name, description,
        import_ref, notes, quantity, insured, archived, asset_id,
        sync_child_entity_locations,
        serial_number, model_number, manufacturer,
        lifetime_warranty, warranty_expires, warranty_details,
        purchase_time, purchase_from, purchase_price,
        sold_time, sold_to, sold_price, sold_notes,
        group_entities, entity_type_entities, entity_children
      )
      SELECT
        i.id, i.created_at, i.updated_at, i.name, i.description,
        i.import_ref, i.notes, i.quantity, i.insured, i.archived, i.asset_id,
        i.sync_child_items_locations,
        i.serial_number, i.model_number, i.manufacturer,
        i.lifetime_warranty, i.warranty_expires, i.warranty_details,
        i.purchase_time, i.purchase_from, i.purchase_price,
        i.sold_time, i.sold_to, i.sold_price, i.sold_notes,
        i.group_items, et.id, i.item_children
      FROM items i
      JOIN entity_types et ON et.group_entity_types = i.group_items AND et.name = 'global.item';
    `,
    "insert items as entities",
  );

  exec(
    db,
    `
      INSERT INTO entities (
        id, created_at, updated_at, name, description,
        quantity, insured, archived, asset_id, purchase_price, sold_price,
        sync_child_entity_locations, lifetime_warranty,
        group_entities, entity_type_entities, entity_children
      )
      SELECT
        l.id, l.created_at, l.updated_at, l.name, l.description,
        1, 0, 0, 0, 0, 0, 0, 0,
        l.group_locations, et.id, l.location_children
      FROM locations l
      JOIN entity_types et ON et.group_entity_types = l.group_locations AND et.name = 'global.location';
    `,
    "insert locations as entities",
  );

  exec(
    db,
    `
      UPDATE entities SET entity_children = (
        SELECT location_items FROM _location_mapping WHERE _location_mapping.id = entities.id
      )
      WHERE EXISTS (SELECT 1 FROM _location_mapping WHERE _location_mapping.id = entities.id);
    `,
    "reparent items",
  );

  for (const table of ["_location_mapping", "items", "locations"]) {
    exec(db, `DROP TABLE ${table};`, `drop ${table}`);
  }
}

function recreateDependentTables(db: Database): void {
  const recreates = [
    {
      name: "entity_fields",
      create: `CREATE TABLE entity_fields (
        id            uuid               not null primary key,
        created_at    datetime           not null,
        updated_at    datetime           not null,
        name          text               not null,
        description   text,
        type          text               not null,
        text_value    text,
        number_value  integer,
        boolean_value bool default false not null,
        time_value    datetime           not null,
        entity_fields uuid
          constraint entity_fields_entities_fields references entities on delete cascade
      );`,
      insert: `INSERT INTO entity_fields SELECT id, created_at, updated_at, name, description, type, text_value, number_value, boolean_value, time_value, item_fields FROM item_fields;`,
      oldName: "item_fields",
    },
    {
      name: "tag_entities",
      create: `CREATE TABLE tag_entities (
        tag_id    uuid not null constraint tag_entities_tag_id references tags on delete cascade,
        entity_id uuid not null constraint tag_entities_entity_id references entities on delete cascade,
        primary key (tag_id, entity_id)
      );`,
      insert: `INSERT INTO tag_entities (tag_id, entity_id) SELECT tag_id, item_id FROM tag_items;`,
      oldName: "tag_items",
    },
    {
      name: "entity_templates",
      create: `CREATE TABLE entity_templates (
        id                        uuid                  not null primary key,
        created_at                datetime              not null,
        updated_at                datetime              not null,
        name                      text                  not null,
        description               text,
        notes                     text,
        default_quantity          real    default 1     not null,
        default_insured           bool    default false not null,
        default_name              text,
        default_description       text,
        default_manufacturer      text,
        default_model_number      text,
        default_lifetime_warranty bool    default false not null,
        default_warranty_details  text,
        include_warranty_fields   bool    default false not null,
        include_purchase_fields   bool    default false not null,
        include_sold_fields       bool    default false not null,
        default_tag_ids           json,
        entity_template_location  uuid constraint entity_templates_entities_location references entities on delete set null,
        group_entity_templates    uuid not null constraint entity_templates_groups_entity_templates references groups on delete cascade
      );`,
      insert: `INSERT INTO entity_templates (id, created_at, updated_at, name, description, notes,
        default_quantity, default_insured, default_name, default_description,
        default_manufacturer, default_model_number, default_lifetime_warranty, default_warranty_details,
        include_warranty_fields, include_purchase_fields, include_sold_fields,
        default_tag_ids, entity_template_location, group_entity_templates)
        SELECT id, created_at, updated_at, name, description, notes,
        default_quantity, default_insured, default_name, default_description,
        default_manufacturer, default_model_number, default_lifetime_warranty, default_warranty_details,
        include_warranty_fields, include_purchase_fields, include_sold_fields,
        default_tag_ids, item_template_location, group_item_templates FROM item_templates;`,
      oldName: "item_templates",
    },
  ];

  for (const table of recreates) {
    exec(db, table.create, `create ${table.name}`);
    exec(db, table.insert, `copy to ${table.name}`);
    exec(db, `DROP TABLE ${table.oldName};`, `drop ${table.oldName}`);
  }

  const renames = [
    {
      name: "template_fields",
      create: `CREATE TABLE template_fields_new (
        id                     uuid               not null primary key,
        created_at             datetime           not null,
        updated_at             datetime           not null,
        name                   text               not null,
        description            text,
        type                   text               not null,
        text_value             text,
        number_value           integer,
        boolean_value          bool default false,
        time_value             datetime,
        entity_template_fields uuid constraint template_fields_entity_templates_fields references entity_templates on delete cascade
      );`,
      insert: `INSERT INTO template_fields_new SELECT id, created_at, updated_at, name, description, type, text_value, number_value, boolean_value, time_value, item_template_fields FROM template_fields;`,
    },
    {
      name: "maintenance_entries",
      create: `CREATE TABLE maintenance_entries_new (
        id             uuid           not null primary key,
        created_at     datetime       not null,
        updated_at     datetime       not null,
        date           datetime,
        scheduled_date datetime,
        name           text           not null,
        description    text,
        cost           real default 0 not null,
        entity_id      uuid           not null constraint maintenance_entries_entities_maintenance_entries references entities on delete cascade
      );`,
      insert: `INSERT INTO maintenance_entries_new SELECT id, created_at, updated_at, date, scheduled_date, name, description, cost, item_id FROM maintenance_entries;`,
    },
    {
      name: "attachments",
      create: `CREATE TABLE attachments_new (
        id                   uuid                                       not null primary key,
        created_at           datetime                                   not null,
        updated_at           datetime                                   not null,
        type                 text    default 'attachment'               not null,
        "primary"            bool    default false                      not null,
        path                 text                                       not null,
        title                text                                       not null,
        mime_type            text    default 'application/octet-stream' not null,
        entity_attachments   uuid constraint attachments_entities_attachments references entities on delete cascade,
        attachment_thumbnail uuid constraint attachments_attachments_thumbnail references attachments_new on delete set null
      );`,
      insert: `INSERT INTO attachments_new SELECT id, created_at, updated_at, type, "primary", path, title, mime_type, item_attachments, attachment_thumbnail FROM attachments;`,
    },
  ];

  for (const table of renames) {
    exec(db, table.create, `create ${table.name}_new`);
    exec(db, table.insert, `copy to ${table.name}_new`);
    exec(db, `DROP TABLE ${table.name};`, `drop ${table.name}`);
    exec(db, `ALTER TABLE ${table.name}_new RENAME TO ${table.name};`, `rename ${table.name}`);
  }
}

function recreateIndexes(db: Database): void {
  const indexes = [
    `CREATE INDEX IF NOT EXISTS entity_name ON entities(name);`,
    `CREATE INDEX IF NOT EXISTS entity_manufacturer ON entities(manufacturer);`,
    `CREATE INDEX IF NOT EXISTS entity_model_number ON entities(model_number);`,
    `CREATE INDEX IF NOT EXISTS entity_serial_number ON entities(serial_number);`,
    `CREATE INDEX IF NOT EXISTS entity_archived ON entities(archived);`,
    `CREATE INDEX IF NOT EXISTS entity_asset_id ON entities(asset_id);`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_entity_id ON attachments(entity_attachments);`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(path);`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(type);`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_thumbnail ON attachments(attachment_thumbnail);`,
  ];
  indexes.forEach((sql, index) => exec(db, sql, `create index ${index}`));
}
