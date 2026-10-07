package v1

import (
	"bytes"
	"encoding/csv"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/hay-kot/httpkit/errchain"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/validate"
)

// HandleDashboardInventoryExport godoc
//
//	@Summary	Export active dashboard inventory
//	@Description	Exports all non-archived inventory items (including nested items, excluding locations) in the authenticated tenant or default collection using the standard HB.* inventory CSV schema.
//	@Tags		Reporting
//	@Produce	text/csv
//	@Success	200	{string}	string	"Inventory CSV; headers only for empty inventory"
//	@Failure	400	{object}	validate.ErrorResponse
//	@Failure	401	{object}	validate.ErrorResponse
//	@Failure	403	{object}	validate.ErrorResponse
//	@Failure	500	{object}	validate.ErrorResponse
//	@Router		/v1/reporting/dashboard-inventory [GET]
//	@Security	Bearer
func (ctrl *V1Controller) HandleDashboardInventoryExport() errchain.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := services.NewContext(r.Context())
		rows, err := ctrl.svc.Entities.ExportDashboardInventoryCSV(ctx, ctx.GID, GetHBURL(r, &ctrl.config.Options, ctrl.url))
		if err != nil {
			return err
		}

		// Prepare the entire CSV before writing success headers. Service or
		// serialization errors must never be downloaded as successful CSVs.
		var buf bytes.Buffer
		writer := csv.NewWriter(&buf)
		if err := writer.WriteAll(rows); err != nil {
			return err
		}
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=homebox-dashboard-inventory.csv")
		_, err = w.Write(buf.Bytes())
		return err
	}
}

// HandleBillOfMaterialsExport godoc
//
//	@Summary	Export Bill of Materials
//	@Tags		Reporting
//	@Produce	json
//	@Success	200	{string}	string	"text/csv"
//	@Router		/v1/reporting/bill-of-materials [GET]
//	@Security	Bearer
func (ctrl *V1Controller) HandleBillOfMaterialsExport() errchain.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant := services.UseTenantCtx(r.Context())

		if tenant == uuid.Nil {
			return validate.NewRequestError(errors.New("tenant required"), http.StatusBadRequest)
		}

		csv, err := ctrl.svc.Entities.ExportBillOfMaterialsCSV(r.Context(), tenant)
		if err != nil {
			return err
		}

		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=bill-of-materials.csv")
		_, err = w.Write(csv)
		return err
	}
}
