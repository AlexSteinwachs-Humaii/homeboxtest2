import { expect, test } from "@playwright/test";

for (const savedTable of [false, true]) {
  test(`items recognition cards and saved view (table: ${savedTable})`, async ({ page, context, baseURL }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 980 });
    await context.addCookies([
      { name: "hb.auth.session", value: "true", url: baseURL! },
      { name: "hb.auth.attachment_token", value: "test-attachment-token", url: baseURL! },
    ]);
    if (savedTable) {
      await page.addInitScript(() => {
        localStorage.setItem("homebox/preferences/location", JSON.stringify({ itemDisplayView: "table" }));
      });
    }
    const items = [
      {
        id: "drill",
        name: "Cordless Drill",
        assetId: "001-024",
        quantity: 2,
        purchasePrice: "129.00",
        imageId: "photo",
        thumbnailId: "thumb",
      },
      {
        id: "tent",
        name: "Camping Tent",
        assetId: "001-026",
        quantity: 1,
        purchasePrice: "0",
      },
      { id: "box", name: "Storage Box", assetId: "001-027", quantity: 3 },
    ].map(item => ({
      ...item,
      parent: { id: "garage", name: "Garage" },
      tags: [],
      description: "",
      archived: false,
      insured: false,
    }));
    await page.route("**/api/v1/**", route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");
      if (path.includes("/attachments/")) {
        return route.fulfill({
          contentType: "image/svg+xml",
          body: "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='green'/></svg>",
        });
      }
      if (path === "/status")
        return route.fulfill({
          json: { build: { version: "v0.0.0" }, latest: { version: "v0.0.0" }, allowRegistration: true },
        });
      if (path === "/users/self")
        return route.fulfill({
          json: {
            item: {
              id: "user",
              name: "Alex",
              email: "alex@example.com",
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
      if (path === "/entities")
        return route.fulfill({
          json:
            url.searchParams.get("isLocation") === "true"
              ? { items: [{ id: "garage", name: "Garage" }] }
              : { items, total: 3, page: 1, pageSize: 12 },
        });
      if (path === "/entities/drill")
        return route.fulfill({
          json: { ...items[0], attachments: [], fields: [] },
        });
      return route.fulfill({ json: [] });
    });
    await page.goto("/items", { waitUntil: "domcontentloaded" });
    const cards = page.getByTestId("item-card");
    const tableButton = page.getByRole("button", {
      name: "Table",
      exact: true,
    });
    const cardButton = page.getByRole("button", { name: "Card", exact: true });
    await expect(tableButton).toBeVisible();
    if (savedTable) {
      await expect(cards).toHaveCount(0);
      await expect(page.getByRole("table")).toBeVisible();
      await cardButton.click();
    }
    await expect(cards).toHaveCount(3);
    const drill = cards.filter({ hasText: "Cordless Drill" });
    for (const text of ["001-024", "Garage", "Quantity 2", "$129.00"]) {
      await expect(drill).toContainText(text);
    }
    await expect(drill.getByRole("img", { name: "Cordless Drill" })).toHaveAttribute("src", /attachments\/thumb/);
    await expect(drill.getByRole("img", { name: "Cordless Drill" })).toHaveJSProperty("naturalWidth", 80);
    for (const name of ["Camping Tent", "Storage Box"]) {
      const card = cards.filter({ hasText: name });
      await expect(card).not.toContainText("$");
      await expect(card.getByRole("img", { name })).toHaveAttribute("src", "/no-image.jpg");
      await expect(card.getByRole("img", { name })).toHaveJSProperty("complete", true);
      await expect(card.getByRole("img", { name })).not.toHaveJSProperty("naturalWidth", 0);
    }
    await page.screenshot({ path: "test-results/calm-home-items.png", fullPage: true });
    await expect(drill.locator("a")).toHaveCount(1);
    await expect(drill.locator("a")).toHaveAttribute("href", "/item/drill");
    // Selection is independent of the detail link.
    const checkbox = drill.getByRole("checkbox");
    if (await checkbox.count()) {
      await expect(drill.locator("a").getByRole("checkbox")).toHaveCount(0);
      await checkbox.click();
      await expect(page).toHaveURL(/\/items\/?$/);
    }
    await tableButton.click();
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole("table")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("table")).toBeVisible();
    await cardButton.click();
    await expect(cards).toHaveCount(3);
    await drill.getByRole("link").click();
    await expect(page).toHaveURL(/\/item\/drill$/);
  });
}
