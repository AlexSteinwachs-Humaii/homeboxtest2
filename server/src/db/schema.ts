import { customType, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { asUuidBytes } from "./storage.ts";

// Models the tables Goose already created. dataType() is only consulted by a
// Drizzle migrator, which this server does not run. UUID columns are blobs,
// never Drizzle's text uuid mode. Datetimes stay text. Bools stay integers.

const uuidBlob = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "blob";
  },
  toDriver(value: Uint8Array): Uint8Array {
    if (!(value instanceof Uint8Array) || value.byteLength !== 16) {
      throw new Error("refusing to store a UUID that is not a 16-byte blob");
    }
    return new Uint8Array(value);
  },
  fromDriver(value: unknown): Uint8Array {
    return asUuidBytes(value);
  },
});

// Pass the stored text through. A Date or number would be a different representation.
const storedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    if (typeof value !== "string") {
      throw new Error("refusing to rewrite a datetime into a non-text value");
    }
    return value;
  },
  fromDriver(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error(`refusing to rewrite datetime stored as ${value === null ? "null" : typeof value}`);
    }
    return value;
  },
});

// Integer 0/1, as modernc stores bool. Not Drizzle boolean mode.
const storedInt = customType<{ data: number; driverData: number }>({
  dataType() {
    return "integer";
  },
  toDriver(value: number): number {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error("refusing to store an integer boolean as a non-integer");
    }
    return value;
  },
  fromDriver(value: unknown): number {
    if (typeof value === "bigint") return Number(value);
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`refusing to rewrite integer boolean stored as ${typeof value}`);
    }
    return value;
  },
});

export const groups = sqliteTable("groups", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
});

export const users = sqliteTable("users", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  password: text("password"),
  isSuperuser: storedInt("is_superuser").notNull(),
  superuser: storedInt("superuser").notNull(),
  activatedOn: storedText("activated_on"),
  oidcIssuer: text("oidc_issuer"),
  oidcSubject: text("oidc_subject"),
  defaultGroupId: uuidBlob("default_group_id"),
  settings: text("settings"),
});

export const userGroups = sqliteTable(
  "user_groups",
  {
    userId: uuidBlob("user_id").notNull(),
    groupId: uuidBlob("group_id").notNull(),
    role: text("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

export const entityTypes = sqliteTable("entity_types", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isLocation: storedInt("is_location").notNull(),
  icon: text("icon"),
  groupEntityTypes: uuidBlob("group_entity_types").notNull(),
  entityTypeDefaultTemplate: uuidBlob("entity_type_default_template"),
});

export const entities = sqliteTable("entities", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  importRef: text("import_ref"),
  notes: text("notes"),
  quantity: real("quantity").notNull(),
  insured: storedInt("insured").notNull(),
  archived: storedInt("archived").notNull(),
  assetId: integer("asset_id").notNull(),
  syncChildEntityLocations: storedInt("sync_child_entity_locations").notNull(),
  serialNumber: text("serial_number"),
  modelNumber: text("model_number"),
  manufacturer: text("manufacturer"),
  lifetimeWarranty: storedInt("lifetime_warranty").notNull(),
  warrantyExpires: storedText("warranty_expires"),
  warrantyDetails: text("warranty_details"),
  purchaseDate: storedText("purchase_date"),
  purchaseFrom: text("purchase_from"),
  purchasePrice: real("purchase_price").notNull(),
  soldDate: storedText("sold_date"),
  soldTo: text("sold_to"),
  soldPrice: real("sold_price").notNull(),
  soldNotes: text("sold_notes"),
  groupEntities: uuidBlob("group_entities").notNull(),
  entityTypeEntities: uuidBlob("entity_type_entities").notNull(),
  entityChildren: uuidBlob("entity_children"),
});

export const entityFields = sqliteTable("entity_fields", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  textValue: text("text_value"),
  numberValue: integer("number_value"),
  booleanValue: storedInt("boolean_value").notNull(),
  timeValue: storedText("time_value").notNull(),
  entityFields: uuidBlob("entity_fields"),
});

export const tags = sqliteTable("tags", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  groupTags: uuidBlob("group_tags").notNull(),
  icon: text("icon"),
  tagChildren: uuidBlob("tag_children"),
});

export const tagEntities = sqliteTable(
  "tag_entities",
  {
    tagId: uuidBlob("tag_id").notNull(),
    entityId: uuidBlob("entity_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tagId, table.entityId] })],
);

export const maintenanceEntries = sqliteTable("maintenance_entries", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  date: storedText("date"),
  scheduledDate: storedText("scheduled_date"),
  name: text("name").notNull(),
  description: text("description"),
  cost: real("cost").notNull(),
  entityId: uuidBlob("entity_id").notNull(),
});

const rawBlob = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "blob";
  },
  toDriver(value: Uint8Array): Uint8Array {
    if (!(value instanceof Uint8Array)) {
      throw new Error("refusing to store a non-blob token");
    }
    return new Uint8Array(value);
  },
  fromDriver(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    throw new Error(`refusing to coerce token blob from ${value === null ? "null" : typeof value}`);
  },
});

export const authTokens = sqliteTable("auth_tokens", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  token: rawBlob("token").notNull(),
  expiresAt: storedText("expires_at").notNull(),
  userAuthTokens: uuidBlob("user_auth_tokens"),
});

export const authRoles = sqliteTable("auth_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(),
  authTokensRoles: uuidBlob("auth_tokens_roles"),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  userId: uuidBlob("user_id").notNull(),
  token: rawBlob("token").notNull(),
  expiresAt: storedText("expires_at").notNull(),
  usedAt: storedText("used_at"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  userId: uuidBlob("user_id").notNull(),
  name: text("name").notNull(),
  token: rawBlob("token").notNull(),
  expiresAt: storedText("expires_at"),
  lastUsedAt: storedText("last_used_at"),
});

export const groupInvitationTokens = sqliteTable("group_invitation_tokens", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  token: rawBlob("token").notNull(),
  expiresAt: storedText("expires_at").notNull(),
  uses: integer("uses").notNull(),
  groupInvitationTokens: uuidBlob("group_invitation_tokens"),
});

export const attachments = sqliteTable("attachments", {
  id: uuidBlob("id").primaryKey().notNull(),
  createdAt: storedText("created_at").notNull(),
  updatedAt: storedText("updated_at").notNull(),
  type: text("type").notNull(),
  primary: storedInt("primary").notNull(),
  path: text("path").notNull(),
  title: text("title").notNull(),
  mimeType: text("mime_type").notNull(),
  entityAttachments: uuidBlob("entity_attachments"),
  attachmentThumbnail: uuidBlob("attachment_thumbnail"),
});

export const schema = {
  groups,
  users,
  userGroups,
  entityTypes,
  entities,
  entityFields,
  tags,
  tagEntities,
  maintenanceEntries,
  attachments,
  authTokens,
  authRoles,
  passwordResetTokens,
  apiKeys,
  groupInvitationTokens,
};
