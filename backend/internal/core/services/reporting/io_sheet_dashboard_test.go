package reporting

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
)

func TestReadItemsWithAncestors(t *testing.T) {
	parent := repo.EntityOut{EntitySummary: repo.EntitySummary{
		ID: uuid.New(), ImportRef: "excluded-parent", Archived: true,
		EntityType: &repo.EntityTypeSummary{IsLocation: false},
	}, Fields: []repo.EntityFieldData{{Name: "excluded", TextValue: "not exported"}}}
	child := repo.EntityOut{EntitySummary: repo.EntitySummary{ID: uuid.New(), Name: "Child"},
		Parent: &repo.EntitySummary{ID: parent.ID},
		Fields: []repo.EntityFieldData{{Name: "included", TextValue: "雪, \"value\"\nnext line"}},
	}
	sheet := IOSheet{}
	// No path query is needed for an item parent at the collection root.
	require.NoError(t, sheet.ReadItemsWithAncestors(context.Background(), []repo.EntityOut{child}, []repo.EntityOut{parent, child}, uuid.Nil, nil, ""))
	require.Len(t, sheet.Rows, 1)
	assert.Equal(t, parent.ImportRef, sheet.Rows[0].ParentImportRef)
	rows, err := sheet.CSV()
	require.NoError(t, err)
	assert.Contains(t, rows[0], "HB.field.included")
	assert.NotContains(t, rows[0], "HB.field.excluded")
	// Reusing a sheet resets its headers, including custom columns.
	require.NoError(t, sheet.ReadItems(context.Background(), nil, uuid.Nil, nil, ""))
	rows, err = sheet.CSV()
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.NotContains(t, rows[0], "HB.field.included")
	standard := IOSheet{}
	require.NoError(t, standard.ReadItems(context.Background(), nil, uuid.Nil, nil, ""))
	expected, err := standard.CSV()
	require.NoError(t, err)
	assert.Equal(t, expected, rows)
}
