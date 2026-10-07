import { BaseAPI, route } from "../base";

export class ReportsAPI extends BaseAPI {
  async dashboardInventoryCSV(): Promise<Blob> {
    const result = await this.http.get<unknown>({
      url: route("/reporting/dashboard-inventory"),
    });
    if (result.error || result.response.headers.get("Content-Type")?.split(";")[0]?.trim() !== "text/csv") {
      throw new Error("Inventory CSV export failed");
    }
    return result.response.blob();
  }

  billOfMaterialsURL(tenant?: string): string {
    if (tenant) {
      return route("/reporting/bill-of-materials", { tenant });
    }

    return route("/reporting/bill-of-materials");
  }
}
