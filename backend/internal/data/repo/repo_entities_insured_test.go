package repo

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEntityRepository_QueryInsuredBeforePagination(t *testing.T) {
	ctx := context.Background()
	items := useEntities(t, 6)
	for i, item := range items {
		_, err := tClient.Entity.UpdateOneID(item.ID).
			SetName(fmt.Sprintf("insurance-filter-fixture-%d", i)).
			SetInsured(i < 4).
			SetArchived(i == 3).Save(ctx)
		require.NoError(t, err)
	}

	insured, uninsured := true, false
	for _, tc := range []struct {
		name            string
		insured         *bool
		includeArchived bool
		total           int
	}{
		{"unset", nil, false, 5},
		{"insured", &insured, false, 3},
		{"uninsured", &uninsured, false, 2},
		{"insured including archived", &insured, true, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seen := make(map[string]bool)
			for page := 1; page <= tc.total; page++ {
				result, err := tRepos.Entities.QueryByGroup(ctx, tGroup.ID, EntityQuery{
					Search:          "insurance-filter-fixture",
					ParentIDs:       []uuid.UUID{items[0].Parent.ID},
					Insured:         tc.insured,
					IncludeArchived: tc.includeArchived,
					Page:            page, PageSize: 1,
				})
				require.NoError(t, err)
				assert.Equal(t, tc.total, result.Total)
				require.Len(t, result.Items, 1)
				item := result.Items[0]
				assert.False(t, seen[item.ID.String()], "pages must not repeat items")
				seen[item.ID.String()] = true
				if tc.insured != nil {
					assert.Equal(t, *tc.insured, item.Insured)
				}
				if !tc.includeArchived {
					assert.False(t, item.Archived)
				}
			}
		})
	}
}
