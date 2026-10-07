package services

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entityfield"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/data/types"
)

func TestDashboardInventoryCSV(t *testing.T) {
	ctx := context.Background()
	group, err := tRepos.Groups.GroupCreate(ctx, "dashboard-"+fk.Str(8), uuid.Nil)
	require.NoError(t, err)
	locationType, err := tRepos.EntityTypes.GetDefault(ctx, group.ID, true)
	require.NoError(t, err)
	itemType, err := tRepos.EntityTypes.GetDefault(ctx, group.ID, false)
	require.NoError(t, err)
	create := func(name, ref string, parent, typ uuid.UUID) repo.EntityOut {
		t.Helper()
		item, err := tRepos.Entities.Create(ctx, group.ID, repo.EntityCreate{Name: name, ImportRef: ref, ParentID: parent, EntityTypeID: typ, Quantity: 1})
		require.NoError(t, err)
		return item
	}
	location := create("屋根, Room", "loc-ref", uuid.Nil, locationType.ID)
	parent := create("Archived parent", "parent-ref", location.ID, itemType.ID)
	require.NoError(t, tClient.Entity.UpdateOneID(parent.ID).SetArchived(true).Exec(ctx))
	_, err = tClient.EntityField.Create().SetName("excluded").SetType(entityfield.TypeText).SetTextValue("private ancestor field").SetEntityID(parent.ID).Save(ctx)
	require.NoError(t, err)
	name := "工具, \"special\"\n第二行"
	child := create(name, "child-ref", parent.ID, itemType.ID)
	date := types.DateFromString("2026-10-07")
	require.NoError(t, tClient.Entity.UpdateOneID(child.ID).SetPurchaseDate(date.Time()).SetPurchasePrice(12.5).SetQuantity(2.25).SetInsured(true).SetNotes("Notes, \"quoted\"\nUnicode: café").Exec(ctx))
	for _, field := range []string{"zeta", "alpha"} {
		_, err = tClient.EntityField.Create().SetName(field).SetType(entityfield.TypeText).SetTextValue("Value, \"quoted\"\n雪").SetEntityID(child.ID).Save(ctx)
		require.NoError(t, err)
	}
	tag, err := tRepos.Tags.Create(ctx, group.ID, repo.TagCreate{Name: "タグ, quoted"})
	require.NoError(t, err)
	require.NoError(t, tClient.Entity.UpdateOneID(child.ID).AddTagIDs(tag.ID).Exec(ctx))
	for i := range 7 {
		create(fmt.Sprintf("Item %d", i), fmt.Sprintf("ref-%d", i), uuid.Nil, itemType.ID)
	}
	foreign, err := tRepos.Groups.GroupCreate(ctx, "foreign-"+fk.Str(8), uuid.Nil)
	require.NoError(t, err)
	foreignType, err := tRepos.EntityTypes.GetDefault(ctx, foreign.ID, false)
	require.NoError(t, err)
	_, err = tRepos.Entities.Create(ctx, foreign.ID, repo.EntityCreate{Name: "Foreign item", EntityTypeID: foreignType.ID})
	require.NoError(t, err)

	rows, err := tSvc.Entities.ExportDashboardInventoryCSV(ctx, group.ID, "https://homebox.example")
	require.NoError(t, err)
	stats, err := tRepos.Groups.StatsGroup(ctx, group.ID)
	require.NoError(t, err)
	require.Len(t, rows, 9)
	assert.EqualValues(t, stats.TotalItems, len(rows)-1)
	header := rows[0]
	col := func(key string) int {
		t.Helper()
		for i, h := range header {
			if h == key {
				return i
			}
		}
		require.FailNow(t, "missing column", key)
		return -1
	}
	assert.NotContains(t, header, "HB.field.excluded")
	assert.Equal(t, []string{"HB.field.alpha", "HB.field.zeta"}, header[len(header)-2:])
	var childRow []string
	for _, row := range rows[1:] {
		assert.NotContains(t, []string{location.Name, parent.Name, "Foreign item"}, row[col("HB.name")])
		if row[col("HB.name")] == name {
			childRow = row
		}
	}
	require.NotNil(t, childRow)
	for key, expected := range map[string]string{
		"HB.parent_import_ref": "parent-ref", "HB.location": location.Name,
		"HB.import_ref": "child-ref", "HB.quantity": "2.25", "HB.purchase_price": "12.5",
		"HB.purchase_date": "2026-10-07", "HB.archived": "false", "HB.insured": "true",
		"HB.tags": tag.Name, "HB.field.alpha": "Value, \"quoted\"\n雪",
		"HB.url": "https://homebox.example/item/" + child.ID.String(),
	} {
		assert.Equal(t, expected, childRow[col(key)], key)
	}

	// The existing full export keeps locations and archived rows. Every dashboard
	// value must match its canonical full-export counterpart, including ancestry.
	full, err := tSvc.Entities.ExportCSV(ctx, group.ID, "https://homebox.example")
	require.NoError(t, err)
	require.Len(t, full, 11)
	for _, row := range rows[1:] {
		var match []string
		for _, candidate := range full[1:] {
			for j, key := range full[0] {
				if key == "HB.import_ref" && candidate[j] == row[col("HB.import_ref")] {
					match = candidate
				}
			}
		}
		require.NotNil(t, match)
		for i, key := range header {
			for j, fullKey := range full[0] {
				if fullKey == key {
					assert.Equal(t, match[j], row[i], key)
				}
			}
		}
	}
	var buf bytes.Buffer
	require.NoError(t, csv.NewWriter(&buf).WriteAll(rows))
	decoded, err := csv.NewReader(&buf).ReadAll()
	require.NoError(t, err)
	assert.Equal(t, rows, decoded)
}

func TestDashboardInventoryCSVEmptyAndError(t *testing.T) {
	ctx := context.Background()
	group, err := tRepos.Groups.GroupCreate(ctx, "empty-dashboard-"+fk.Str(8), uuid.Nil)
	require.NoError(t, err)
	standard, err := tSvc.Entities.ExportCSV(ctx, group.ID, "https://homebox.example")
	require.NoError(t, err)
	locationType, err := tRepos.EntityTypes.GetDefault(ctx, group.ID, true)
	require.NoError(t, err)
	_, err = tRepos.Entities.Create(ctx, group.ID, repo.EntityCreate{Name: "Location only", EntityTypeID: locationType.ID})
	require.NoError(t, err)
	rows, err := tSvc.Entities.ExportDashboardInventoryCSV(ctx, group.ID, "https://homebox.example")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, standard, rows)
	assert.Contains(t, rows[0], "HB.name")
	assert.Contains(t, rows[0], "HB.parent_import_ref")
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	rows, err = tSvc.Entities.ExportDashboardInventoryCSV(canceled, group.ID, "https://homebox.example")
	require.Error(t, err)
	assert.Nil(t, rows)
}
