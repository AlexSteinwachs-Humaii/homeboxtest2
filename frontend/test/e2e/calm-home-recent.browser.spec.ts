import { expect, test } from "@playwright/test";

for (const empty of [false, true]) {
  test(`overview recent items, shortcuts and recorded purchases (empty: ${empty})`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route("**/api/v1/entities?*", route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("isLocation") === "true") {
        return route.fulfill({
          json: {
            items: empty
              ? []
              : ["Garage", "Kitchen", "Closet", "Attic"].map((name, i) => ({
                  id: `place-${i}`,
                  name,
                  // The locations API omits itemCount when it is zero.
                  ...(i === 0 ? {} : { itemCount: i * 2 }),
                })),
          },
        });
      }
      if (query.get("orderBy") === "createdAt") {
        expect(query.get("pageSize")).toBe("5");
        return route.fulfill({
          json: {
            items: empty
              ? []
              : [
                  {
                    id: "drill",
                    name: "Cordless Drill",
                    parent: { id: "place-0", name: "Garage" },
                    quantity: 2,
                    imageId: "photo",
                    thumbnailId: "thumb",
                  },
                  { id: "tent", name: "Camping Tent", parent: { id: "place-2", name: "Closet" }, quantity: 1 },
                ],
          },
        });
      }
      return route.continue();
    });
    await page.route("**/api/v1/groups/statistics", route =>
      route.fulfill({
        json: { totalItems: empty ? 0 : 128, totalItemPrice: empty ? 0 : 6420, totalTags: 99, totalLocations: 8 },
      })
    );
    await page.route("**/api/v1/entities/drill/attachments/thumb?*", route =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='green'/></svg>",
      })
    );
    const recentResponse = page.waitForResponse(response => response.url().includes("orderBy=createdAt"));
    const locationsResponse = page.waitForResponse(response => response.url().includes("filterChildren=true"));
    const statsResponse = page.waitForResponse("**/api/v1/groups/statistics");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.fill("input[type='text']", "demo@example.com");
    await page.fill("input[type='password']", "demodemo");
    await page.click("button[type='submit']");
    await expect(page).toHaveURL("/home");
    await Promise.all([recentResponse, locationsResponse, statsResponse]);

    const recent = page.getByTestId("recent-items");
    const locations = page.getByTestId("location-shortcuts");
    const summary = page.getByTestId("purchase-summary");
    await expect(recent.getByRole("link", { name: "All items" })).toHaveAttribute("href", "/items");
    await expect(locations.getByRole("link", { name: "All locations" })).toHaveAttribute("href", "/locations");
    await expect(summary.locator("dt")).toHaveText(["Total Items", "Recorded purchase prices"]);
    await expect(summary).not.toContainText(/insured|replacement|Total Value/i);
    await expect(page.locator("main").getByRole("heading", { name: "Tags", exact: true })).toHaveCount(0);
    if (empty) {
      await expect(recent).toContainText("No Items Found");
      await expect(locations).toContainText("No Locations Found");
      await expect(summary.locator("dd").first()).toHaveText("0");
      await expect(summary.locator("dd").last()).toContainText("0.00");
    } else {
      await expect(recent.locator("li")).toHaveCount(2);
      await expect(recent.locator("li").first()).toContainText("Cordless Drill");
      await expect(recent.locator("li").first()).toContainText("Garage · Quantity 2");
      await expect(recent.locator("li").first().getByRole("link")).toHaveAttribute("href", "/item/drill");
      await expect(recent.getByRole("img", { name: "Cordless Drill" })).toHaveAttribute("src", /attachments\/thumb/);
      await expect(recent.getByRole("img", { name: "Camping Tent" })).toHaveAttribute("src", "/no-image.jpg");
      await expect(locations.locator("li")).toHaveCount(3);
      await expect(locations.locator("li").first()).toContainText("0 Items");
      await expect(locations.locator("li").first().getByRole("link")).toHaveAttribute("href", "/location/place-0");
      await expect(locations).not.toContainText("Attic");
      await expect(summary.locator("dd").first()).toHaveText("128");
      await expect(summary.locator("dd").last()).toContainText("6,420.00");
      await expect(recent.getByRole("img", { name: "Cordless Drill" })).toHaveJSProperty("naturalWidth", 80);
      await page.screenshot({ path: "test-results/calm-home-recent.png", fullPage: true });
    }
    const sidebar = page.locator("[data-sidebar='content']");
    await sidebar.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(sidebar.getByRole("link", { name: "Tags", exact: true })).toHaveAttribute("href", "/tags");
    await sidebar.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(page).toHaveURL("/tags");
  });
}
