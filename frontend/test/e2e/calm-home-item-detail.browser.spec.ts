import { expect, test } from "@playwright/test";

for (const hasPhoto of [true, false]) {
  test(`item detail recognition header (photo: ${hasPhoto})`, async ({ page, context, baseURL }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 1080 });
    await context.addCookies([
      { name: "hb.auth.session", value: "true", url: baseURL! },
      { name: "hb.auth.attachment_token", value: "test-attachment-token", url: baseURL! },
    ]);
    await page.route("**/api/v1/**", route => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (path.includes("/attachments/"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='green'/></svg>",
        });
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
      if (path === "/entities/drill/path")
        return route.fulfill({
          json: [
            { id: "garage", name: "Garage", type: "location" },
            { id: "shelf", name: "Tool Shelf", type: "location" },
            { id: "box", name: "Toolbox", type: "item" },
            { id: "drill", name: "Cordless Drill", type: "item" },
          ],
        });
      if (path === "/entities/drill")
        return route.fulfill({
          json: {
            id: "drill",
            name: "Cordless Drill",
            assetId: "001-024",
            quantity: 1,
            description: "Kept on the tool shelf.",
            serialNumber: "HB-2026-041",
            modelNumber: "18V-2",
            manufacturer: "Bosch",
            notes: "",
            tags: [],
            fields: [],
            parent: { id: "box", name: "Toolbox", isLocation: false },
            createdAt: "2026-06-01T00:00:00Z",
            updatedAt: "2026-06-07T00:00:00Z",
            purchasePrice: "129.00",
            soldPrice: "0",
            insured: false,
            attachments: hasPhoto
              ? [{ id: "photo", type: "photo", mimeType: "image/svg+xml", thumbnail: { id: "thumb" } }]
              : [],
          },
        });
      if (path === "/entities") return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/item/drill", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Cordless Drill", exact: true })).toBeVisible({ timeout: 60000 });
    const photo = page.getByTestId("item-primary-photo");
    const image = photo.getByRole("img", { name: "Cordless Drill" });
    await expect(image).toHaveAttribute("src", hasPhoto ? /attachments\/thumb/ : "/no-image.jpg");
    await expect(image).not.toHaveJSProperty("naturalWidth", 0);
    const breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Garage" })).toHaveAttribute("href", "/location/garage");
    await expect(breadcrumb.getByRole("link", { name: "Tool Shelf" })).toHaveAttribute("href", "/location/shelf");
    await expect(breadcrumb.getByRole("link", { name: "Toolbox" })).toHaveAttribute("href", "/item/box");
    const detailsTab = page.getByRole("link", { name: "Details", exact: true });
    await expect(detailsTab).toHaveAttribute("href", "/item/drill");
    await expect(page.locator('a[href="/item/drill/maintenance"]')).toHaveText("Maintenance");
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveAttribute("href", "/item/drill/edit");
    await expect(page.getByRole("link", { name: "Edit item", exact: true })).toHaveAttribute(
      "href",
      "/item/drill/edit"
    );
    const fields = page.getByText("Quantity", { exact: true });
    await expect(fields).toBeVisible();
    const fieldsBox = (await fields.boundingBox())!;
    for (const element of [photo, breadcrumb, detailsTab]) {
      const box = (await element.boundingBox())!;
      expect(box.y + box.height).toBeLessThan(fieldsBox.y);
    }
    await page.screenshot({ path: `test-results/item-header-${hasPhoto}.png`, fullPage: true });
    if (hasPhoto) {
      await photo.getByRole("button").click();
      await expect(page.getByRole("dialog").getByRole("img", { name: "attachment image" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    for (const name of ["Duplicate", "Save as Template", "Delete"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Create Subitem", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
