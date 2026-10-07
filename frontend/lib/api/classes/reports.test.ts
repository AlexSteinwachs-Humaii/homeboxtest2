import { afterEach, describe, expect, test, vi } from "vitest";
import { ReportsAPI } from "./reports";
import { Requests } from "../../requests";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard inventory download", () => {
  test.each(["HB.name\n", "HB.name\nInventory\n"])("downloads CSV including headers only", async csv => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      })
    );
    vi.stubGlobal("fetch", fetch);
    const http = new Requests("", "Bearer test-token", {
      "X-Tenant": "active-collection",
    });
    const interceptor = vi.fn();
    http.addResponseInterceptor(interceptor);
    const blob = await new ReportsAPI(http).dashboardInventoryCSV();
    expect(await blob.text()).toBe(csv);
    expect(fetch).toHaveBeenCalledWith("/api/v1/reporting/dashboard-inventory", {
      method: "GET",
      headers: {
        Authorization: "Bearer test-token",
        "X-Tenant": "active-collection",
      },
    });
    expect(interceptor).toHaveBeenCalledOnce();
  });

  test.each([403, 500, 200])("rejects non-CSV/error responses (%i)", async status => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"error":"failed"}', {
          status,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(new ReportsAPI(new Requests("")).dashboardInventoryCSV()).rejects.toThrow();
  });

  test("rejects even a CSV error response and propagates network failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("error", {
          status: 500,
          headers: { "Content-Type": "text/csv" },
        })
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const reports = new ReportsAPI(new Requests(""));
    await expect(reports.dashboardInventoryCSV()).rejects.toThrow();
    await expect(reports.dashboardInventoryCSV()).rejects.toThrow("offline");
  });
});
