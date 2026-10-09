// Writes a homebox.db fixture with the same driver the Go server uses
// (modernc.org/sqlite via cgofreesqlite, _time_format=sqlite).
//
// UUID primary keys are inserted as the 16 google/uuid bytes (id[:]), which is
// the byte order uuid.String() formats. One tag is also inserted through
// uuid.UUID.Value(), the text encoding Ent actually binds, so a reader can
// prove it does not rewrite that row.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	_ "github.com/sysadminsmedia/homebox/backend/pkgs/cgofreesqlite"
)

const (
	groupID        = "00112233-4455-6677-8899-aabbccddeeff"
	userID         = "11111111-1111-4111-8111-111111111111"
	locationTypeID = "22222222-2222-4222-8222-222222222222"
	itemTypeID     = "33333333-3333-4333-8333-333333333333"
	locationID     = "44444444-4444-4444-8444-444444444444"
	itemID         = "55555555-5555-4555-8555-555555555555"
	tagID          = "66666666-6666-4666-8666-666666666666"
	fieldID        = "77777777-7777-4777-8777-777777777777"
	maintenanceID  = "88888888-8888-4888-8888-888888888888"
	legacyGroupID  = "99999999-9999-4999-8999-999999999999"
	legacyTagID    = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: write_fixture <homebox.db>")
		os.Exit(2)
	}
	db, err := sql.Open("sqlite3", "file:"+os.Args[1]+"?_fk=1&_time_format=sqlite")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	created := time.Date(2020, 6, 15, 8, 30, 1, 123456789, time.UTC)
	updated := time.Date(2021, 7, 16, 9, 31, 2, 100000000, time.UTC)
	purchase := time.Date(2019, 1, 2, 15, 4, 5, 0, time.UTC)
	warranty := time.Date(2025, 12, 31, 23, 59, 58, 900000000, time.UTC)
	fieldTime := time.Date(2018, 7, 8, 9, 10, 11, 0, time.UTC)
	maintDate := time.Date(2021, 3, 4, 0, 0, 0, 0, time.UTC)
	scheduled := time.Date(2022, 4, 5, 12, 0, 0, 500000000, time.UTC)

	exec(db, `INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, ?, ?, ?, ?)`,
		blob(groupID), created, updated, "Home", "usd")
	exec(db, `INSERT INTO users (id, created_at, updated_at, name, email, is_superuser, superuser, default_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		blob(userID), created, updated, "Ada", "ada@example.com", false, true, blob(groupID))
	exec(db, `INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`,
		blob(userID), blob(groupID), "owner")
	exec(db, `INSERT INTO entity_types (id, created_at, updated_at, name, description, is_location, group_entity_types) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		blob(locationTypeID), created, updated, "Location", "a place", true, blob(groupID))
	exec(db, `INSERT INTO entity_types (id, created_at, updated_at, name, description, is_location, group_entity_types) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		blob(itemTypeID), created, updated, "Item", "", false, blob(groupID))
	exec(db, `INSERT INTO entities (
		id, created_at, updated_at, name, description, quantity, insured, archived, asset_id,
		sync_child_entity_locations, lifetime_warranty, warranty_expires, purchase_date, purchase_price,
		sold_price, group_entities, entity_type_entities
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		blob(locationID), created, updated, "Kitchen", "downstairs", 1.0, false, false, int64(0),
		false, false, nil, nil, 0.0, 0.0, blob(groupID), blob(locationTypeID))
	exec(db, `INSERT INTO entities (
		id, created_at, updated_at, name, description, notes, quantity, insured, archived, asset_id,
		sync_child_entity_locations, serial_number, model_number, manufacturer,
		lifetime_warranty, warranty_expires, purchase_date, purchase_price, sold_price,
		group_entities, entity_type_entities, entity_children
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		blob(itemID), created, updated, "Mug", "blue", "chipped", 2.5, true, false, int64(42),
		true, "SN-1", "M-9", "Acme",
		false, warranty, purchase, 12.25, 0.0,
		blob(groupID), blob(itemTypeID), blob(locationID))
	exec(db, `INSERT INTO tags (id, created_at, updated_at, name, description, color, group_tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		blob(tagID), created, updated, "Kitchenware", "cups", "#112233", blob(groupID))
	exec(db, `INSERT INTO tag_entities (tag_id, entity_id) VALUES (?, ?)`, blob(tagID), blob(itemID))
	exec(db, `INSERT INTO entity_fields (
		id, created_at, updated_at, name, description, type, text_value, number_value, boolean_value, time_value, entity_fields
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		blob(fieldID), created, updated, "Color", "custom", "text", "blue", 7, true, fieldTime, blob(itemID))
	exec(db, `INSERT INTO maintenance_entries (
		id, created_at, updated_at, date, scheduled_date, name, description, cost, entity_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		blob(maintenanceID), created, updated, maintDate, scheduled, "Reglaze", "chip", 3.5, blob(itemID))

	// Ent binds uuid.UUID via Value(), which is the canonical text form.
	legacyGroup := uuid.MustParse(legacyGroupID)
	legacyTag := uuid.MustParse(legacyTagID)
	exec(db, `INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, ?, ?, ?, ?)`,
		legacyGroup, created, updated, "Legacy", "eur")
	exec(db, `INSERT INTO tags (id, created_at, updated_at, name, group_tags) VALUES (?, ?, ?, ?, ?)`,
		legacyTag, created, updated, "Legacy tag", legacyGroup)

	out := map[string]string{
		"groupId":        groupID,
		"userId":         userID,
		"locationTypeId": locationTypeID,
		"itemTypeId":     itemTypeID,
		"locationId":     locationID,
		"itemId":         itemID,
		"tagId":          tagID,
		"fieldId":        fieldID,
		"maintenanceId":  maintenanceID,
		"legacyGroupId":  legacyGroupID,
		"legacyTagId":    legacyTagID,
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}

func blob(id string) []byte {
	parsed := uuid.MustParse(id)
	out := make([]byte, 16)
	copy(out, parsed[:])
	return out
}

func exec(db *sql.DB, query string, args ...any) {
	if _, err := db.Exec(query, args...); err != nil {
		panic(fmt.Errorf("%s: %w", query, err))
	}
}
