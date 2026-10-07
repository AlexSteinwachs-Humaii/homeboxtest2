package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hay-kot/httpkit/errchain"
	"github.com/rs/zerolog/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	v1 "github.com/sysadminsmedia/homebox/backend/app/api/handlers/v1"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services/reporting/eventbus"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/authroles"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/config"
	"github.com/sysadminsmedia/homebox/backend/internal/web/mid"
	_ "github.com/sysadminsmedia/homebox/backend/pkgs/cgofreesqlite"
	"github.com/sysadminsmedia/homebox/backend/pkgs/hasher"
)

// Exercise the mounted route, including real token, tenant and role middleware.
func TestDashboardExportRoute(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client, err := ent.Open("sqlite3", "file:dashboard-route-"+uuid.NewString()+"?mode=memory&cache=shared&_fk=1&_time_format=sqlite")
	require.NoError(t, err)
	defer func() { require.NoError(t, client.Close()) }()
	require.NoError(t, client.Schema.Create(ctx))
	bus := eventbus.New()
	go func() { _ = bus.Run(ctx) }()
	repos := repo.New(client, bus, config.Storage{}, "mem://{{ .Topic }}", config.Thumbnail{})
	group, err := repos.Groups.GroupCreate(ctx, "Default", uuid.Nil)
	require.NoError(t, err)
	other, err := repos.Groups.GroupCreate(ctx, "Other", uuid.Nil)
	require.NoError(t, err)
	foreign, err := repos.Groups.GroupCreate(ctx, "Foreign", uuid.Nil)
	require.NoError(t, err)
	user, err := repos.Users.Create(ctx, repo.UserCreate{Name: "CSV user", Email: "csv@example.test", DefaultGroupID: group.ID})
	require.NoError(t, err)
	// Explicitly grant membership in a second collection.
	require.NoError(t, client.User.UpdateOneID(user.ID).AddGroupIDs(other.ID).Exec(ctx))
	token := "dashboard-route-test-token"
	_, err = repos.AuthTokens.CreateToken(ctx, repo.UserAuthTokenCreate{UserID: user.ID, TokenHash: hasher.HashToken(token), ExpiresAt: time.Now().Add(time.Hour)}, authroles.RoleUser)
	require.NoError(t, err)
	for _, g := range []repo.Group{group, other, foreign} {
		itemType, err := repos.EntityTypes.GetDefault(ctx, g.ID, false)
		require.NoError(t, err)
		_, err = repos.Entities.Create(ctx, g.ID, repo.EntityCreate{Name: g.Name + ", \"item\"\n雪", ImportRef: g.Name, EntityTypeID: itemType.ID, Quantity: 1})
		require.NoError(t, err)
		locationType, err := repos.EntityTypes.GetDefault(ctx, g.ID, true)
		require.NoError(t, err)
		_, err = repos.Entities.Create(ctx, g.ID, repo.EntityCreate{Name: "Location", EntityTypeID: locationType.ID})
		require.NoError(t, err)
		archived, err := repos.Entities.Create(ctx, g.ID, repo.EntityCreate{Name: "Archived", EntityTypeID: itemType.ID})
		require.NoError(t, err)
		require.NoError(t, client.Entity.UpdateOneID(archived.ID).SetArchived(true).Exec(ctx))
	}
	a := &app{conf: &config.Config{}, repos: repos, services: services.New(repos), bus: bus}
	router := chi.NewRouter()
	a.mountRoutes(router, errchain.New(mid.Errors(log.Logger)), repos)
	request := func(path, tenant, bearer string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if tenant != "" {
			r.Header.Set("X-Tenant", tenant)
		}
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	path := "/api/v1/reporting/dashboard-inventory"
	for _, tc := range []struct {
		name, tenant, token string
		status              int
		item                string
	}{
		{"default", "", token, http.StatusOK, group.Name},
		{"explicit", other.ID.String(), token, http.StatusOK, other.Name},
		{"foreign", foreign.ID.String(), token, http.StatusForbidden, ""},
		{"anonymous", "", "", http.StatusUnauthorized, ""},
		{"malformed tenant", "not-a-uuid", token, http.StatusBadRequest, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(path, tc.tenant, tc.token)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			if tc.status != http.StatusOK {
				assert.NotEqual(t, "text/csv", w.Header().Get("Content-Type"))
				assert.Empty(t, w.Header().Get("Content-Disposition"))
				return
			}
			assert.Equal(t, "text/csv", w.Header().Get("Content-Type"))
			disposition, params, err := mime.ParseMediaType(w.Header().Get("Content-Disposition"))
			require.NoError(t, err)
			assert.Equal(t, "attachment", disposition)
			assert.Equal(t, "homebox-dashboard-inventory.csv", params["filename"])
			rows, err := csv.NewReader(w.Body).ReadAll()
			require.NoError(t, err)
			require.Len(t, rows, 2)
			for i, h := range rows[0] {
				if h == "HB.name" {
					assert.Equal(t, tc.item+", \"item\"\n雪", rows[1][i])
				}
			}
			statistics := request("/api/v1/groups/statistics", tc.tenant, tc.token)
			require.Equal(t, http.StatusOK, statistics.Code)
			var stats repo.GroupStatistics
			require.NoError(t, json.Unmarshal(statistics.Body.Bytes(), &stats))
			assert.EqualValues(t, stats.TotalItems, len(rows)-1)
		})
	}
	// Existing endpoints still include both locations and archived inventory.
	for _, legacy := range []string{"/api/v1/entities/export", "/api/v1/reporting/bill-of-materials"} {
		w := request(legacy, group.ID.String(), token)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		rows, err := csv.NewReader(w.Body).ReadAll()
		require.NoError(t, err)
		assert.Len(t, rows, 4)
	}
	// Empty active inventory still downloads canonical headers, not a blank file.
	otherItems, err := repos.Entities.GetAll(ctx, other.ID)
	require.NoError(t, err)
	for _, item := range otherItems {
		require.NoError(t, client.Entity.DeleteOneID(item.ID).Exec(ctx))
	}
	empty := request(path, other.ID.String(), token)
	require.Equal(t, http.StatusOK, empty.Code)
	assert.Equal(t, "text/csv", empty.Header().Get("Content-Type"))
	emptyRows, err := csv.NewReader(empty.Body).ReadAll()
	require.NoError(t, err)
	require.Len(t, emptyRows, 1)
	assert.Contains(t, emptyRows[0], "HB.name")

	// An actual service failure must escape the handler without CSV success headers.
	r := httptest.NewRequest(http.MethodGet, path, nil)
	failedCtx, stop := context.WithCancel(services.SetUserCtx(r.Context(), &user, token))
	stop()
	ctrl := v1.NewControllerV1(a.services, repos, bus, a.conf).HandleDashboardInventoryExport()
	w := httptest.NewRecorder()
	require.Error(t, ctrl(w, r.WithContext(failedCtx)))
	assert.Empty(t, w.Header().Get("Content-Disposition"))
	assert.False(t, strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv"))
	assert.Empty(t, w.Body.String())
}
