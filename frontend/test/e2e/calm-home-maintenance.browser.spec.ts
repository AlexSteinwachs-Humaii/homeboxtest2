import { expect, test } from "@playwright/test";

for (const overdue of [false, true]) {
  test(`maintenance keeps history on page and filters locally (overdue: ${overdue})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
    const requests: string[] = [];
    const itemRequests: string[] = [];
    const rows = [
      {
        id: "done",
        name: "Sharpen mower blade",
        itemID: "mower",
        itemName: "Lawn mower",
        scheduledDate: "2025-09-01",
        completedDate: "2025-09-12",
        cost: "0",
        description: "",
      },
      {
        id: "scheduled",
        name: "Replace air filter",
        itemID: "purifier",
        itemName: "Air Purifier",
        scheduledDate: overdue ? "2020-10-10" : "2099-10-10",
        completedDate: "0001-01-01T00:00:00Z",
        cost: "0",
        description: "",
      },
    ];
    await page.route("**/api/v1/**", route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");
      if (path === "/status")
        return route.fulfill({
          json: { build: { version: "v0.0.0" }, latest: { version: "v0.0.0" } },
        });
      if (path === "/users/self")
        return route.fulfill({
          json: {
            item: {
              id: "user",
              name: "Alex",
              groupId: "home",
              group: { id: "home", name: "My Home" },
            },
          },
        });
      if (path === "/users/self/settings") return route.fulfill({ json: { item: {} } });
      if (path === "/groups")
        return route.fulfill({
          json: { id: "home", name: "My Home", currency: "USD" },
        });
      if (path === "/groups/all")
        return route.fulfill({
          json: [{ id: "home", name: "My Home", currency: "USD" }],
        });
      if (path === "/entities/mower/maintenance") {
        itemRequests.push(url.searchParams.get("status")!);
        return route.fulfill({ json: url.searchParams.get("status") === "scheduled" ? [] : [rows[0]] });
      }
      if (path === "/entities/mower")
        return route.fulfill({
          json: {
            id: "mower",
            name: "Lawn mower",
            assetId: "001-024",
            quantity: 1,
            tags: [],
            fields: [],
            attachments: [],
            description: "",
            notes: "",
            purchasePrice: "0",
            soldPrice: "0",
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01",
          },
        });
      if (path === "/maintenance") {
        requests.push(url.searchParams.get("status")!);
        return route.fulfill({ json: rows });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto("/maintenance", { waitUntil: "domcontentloaded" });
    const cards = page.getByTestId("maintenance-entry");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Replace air filter");
    await expect(cards.nth(1)).toContainText("Lawn mower");
    await expect(cards.nth(1)).toContainText("Completed Date:");
    await expect(cards.nth(1)).toContainText("2025");
    await expect(page.getByRole("status").filter({ hasText: "1 scheduled" })).toContainText(
      overdue ? "1 overdue" : "nothing overdue"
    );
    await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Replace air filter");
    await expect(page.getByRole("heading", { name: "Completed", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Sharpen mower blade");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(cards).toHaveCount(2);
    expect(requests).toEqual(["both"]);
    await expect(page.getByText(/warranty|completeness|total cost|monthly average/i)).toHaveCount(0);
    await page.screenshot({ path: `test-results/calm-maintenance-${overdue}.png`, fullPage: true });

    await cards.nth(1).getByRole("link", { name: "Lawn mower", exact: true }).click();
    await expect(page).toHaveURL(/\/item\/mower\/maintenance\/?$/);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Sharpen mower blade");
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
    const itemRequestsOnLoad = [...itemRequests];
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByText("No scheduled tasks.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(cards).toHaveCount(1);
    expect(itemRequests.filter(status => status === "both")).toHaveLength(1);
    expect(itemRequests).toEqual(itemRequestsOnLoad);
  });
}
