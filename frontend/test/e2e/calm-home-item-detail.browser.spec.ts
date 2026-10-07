import { expect, test, type Page } from "@playwright/test";

for (const hasPhoto of [true, false]) {
  test(`item detail recognition header (photo: ${hasPhoto})`, async ({ page, context, baseURL }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 1080 });
    await context.addCookies([
      { name: "hb.auth.session", value: "true", url: baseURL! },
      { name: "hb.auth.attachment_token", value: "test-attachment-token", url: baseURL! },
    ]);
    await mockItem(page, hasPhoto);
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
    const record = page.getByTestId("item-record");
    await expect(record.getByRole("heading", { name: "Record", exact: true })).toBeVisible();
    for (const value of [
      "Quantity",
      "Location",
      "Serial Number",
      "Model Number",
      "Manufacturer",
      "Insured",
      "Asset ID",
      "HB-2026-041",
      "18V-2",
      "Bosch",
      "001-024",
    ]) {
      await expect(record.getByText(value, { exact: true })).toBeVisible();
    }
    await expect(record.getByRole("link", { name: "Tool Shelf" })).toHaveAttribute("href", "/location/shelf");
    await expect(
      record
        .locator("dl > div")
        .filter({ has: page.getByText("Insured", { exact: true }) })
        .locator("dd")
    ).toHaveText("No");
    const purchase = page.getByTestId("item-purchase");
    await expect(purchase.getByRole("heading", { name: "Recorded purchase information", exact: true })).toBeVisible();
    await expect(purchase.getByText("$129.00", { exact: true })).toBeVisible();
    await expect(purchase.getByText("Purchase Date", { exact: true })).toBeVisible();
    await expect(purchase.locator("dd").filter({ hasText: /2026/ })).toContainText("06/01/2026");
    const attachments = page.getByTestId("item-attachments");
    for (const type of ["manual", "receipt", "warranty", "attachment"]) {
      await expect(attachments.getByText(`${type}.pdf`, { exact: true })).toBeVisible();
      await expect(attachments.locator(`a[download='${type}.pdf']`)).toHaveAttribute(
        "href",
        new RegExp(`attachments/${type}`)
      );
    }
    const recordBox = (await record.boundingBox())!;
    const purchaseBox = (await purchase.boundingBox())!;
    const attachmentsBox = (await attachments.boundingBox())!;
    expect(purchaseBox.x).toBeGreaterThan(recordBox.x);
    expect(purchaseBox.y).toBe(recordBox.y);
    expect(attachmentsBox.y).toBeGreaterThan(purchaseBox.y + purchaseBox.height);
    await expect(page.getByRole("heading", { name: "Warranty Details", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sold Details", exact: true })).toBeVisible();
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

async function mockItem(page: Page, hasPhoto: boolean, empty = false) {
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
        json: empty
          ? []
          : [
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
          serialNumber: empty ? "" : "HB-2026-041",
          modelNumber: empty ? "" : "18V-2",
          manufacturer: empty ? "" : "Bosch",
          notes: "",
          tags: [],
          fields: [],
          parent: { id: "box", name: "Toolbox", isLocation: false },
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-07T00:00:00Z",
          purchasePrice: empty ? 0 : 129,
          purchaseDate: empty ? "0001-01-01T00:00:00Z" : "2026-06-01T00:00:00Z",
          purchaseFrom: empty ? "" : "Hardware Shop",
          soldDate: "2026-06-03T00:00:00Z",
          soldTo: "Buyer",
          warrantyDetails: "Two year cover",
          lifetimeWarranty: true,
          soldPrice: "0",
          insured: false,
          attachments: [
            ...(hasPhoto
              ? [{ id: "photo", type: "photo", mimeType: "image/svg+xml", thumbnail: { id: "thumb" } }]
              : []),
            ...["manual", "receipt", "warranty", "attachment"].map(type => ({
              id: type,
              type,
              title: `${type}.pdf`,
              mimeType: "application/pdf",
              path: `${type}.pdf`,
            })),
          ],
        },
      });
    if (path === "/entities") return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ json: [] });
  });
}

test("empty record and purchase fields respect the saved show-empty preference", async ({ page, context, baseURL }) => {
  test.slow();
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
  await page.addInitScript(() => {
    localStorage.setItem("homebox/preferences/location", JSON.stringify({ showEmpty: false }));
  });
  await mockItem(page, false, true);
  await page.goto("/item/drill");
  const record = page.getByTestId("item-record");
  await expect(record.getByRole("heading", { name: "Record", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(record.getByText("Location", { exact: true })).toHaveCount(0);
  await expect(record.getByText("Serial Number", { exact: true })).toHaveCount(0);
  await expect(record.getByText("Model Number", { exact: true })).toHaveCount(0);
  await expect(record.getByText("Manufacturer", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("item-purchase")).toHaveCount(0);
  await record.getByRole("switch").click();
  await expect(record.getByText("Location", { exact: true })).toBeVisible();
  await expect(
    record
      .locator("dl > div")
      .filter({ has: page.getByText("Location", { exact: true }) })
      .locator("dd")
  ).toBeEmpty();
  await expect(record.getByText("Serial Number", { exact: true })).toBeVisible();
  const purchase = page.getByTestId("item-purchase");
  await expect(purchase.getByText("Purchase Date", { exact: true })).toBeVisible();
  await expect(purchase.getByText("Purchase Price", { exact: true })).toBeVisible();
  await record.getByRole("switch").click();
  await expect(purchase).toHaveCount(0);
  await expect(page.getByTestId("item-attachments").getByText("manual.pdf", { exact: true })).toBeVisible();
});

async function openMaintenanceItem(page: Page, context: import("@playwright/test").BrowserContext, baseURL: string) {
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL }]);
  await mockItem(page, false);
}

test("empty maintenance offers the existing dialog and creates only on save", async ({ page, context, baseURL }) => {
  test.slow();
  await openMaintenanceItem(page, context, baseURL!);
  const created: Record<string, unknown>[] = [];
  await page.route("**/api/v1/entities/drill/maintenance*", route => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: "task", ...created[0] } });
    }
    expect(new URL(route.request().url()).searchParams.get("status")).toBe("scheduled");
    return route.fulfill({ json: created.length ? [{ id: "task", ...created[0] }] : [] });
  });
  await page.goto("/item/drill");
  const empty = page.getByTestId("item-maintenance-empty");
  await expect(empty.getByRole("heading", { name: "No maintenance scheduled", exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({ path: "test-results/item-maintenance-empty.png", fullPage: true });
  await empty.getByRole("button", { name: "Schedule a task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New Entry", exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Entry Name", exact: true }).fill("Charge batteries");
  expect(created).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(created).toHaveLength(0);
  await expect(empty).toBeVisible();
  await empty.getByRole("button", { name: "Schedule a task", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Entry Name", exact: true }).fill("Charge batteries");
  // Use the existing date picker to select today as a scheduled calendar date.
  await dialog.locator(".dp__input").nth(1).click();
  await dialog.locator(".dp__today").click();
  await dialog.getByRole("button", { name: "Select", exact: true }).click();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(empty).toHaveCount(0);
  expect(created).toHaveLength(1);
  expect(created[0]!.name).toBe("Charge batteries");
  expect(created[0]!.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

for (const state of ["scheduled", "failed", "loading"] as const) {
  test(`maintenance empty state is hidden when ${state}`, async ({ page, context, baseURL }) => {
    test.slow();
    await openMaintenanceItem(page, context, baseURL!);
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route("**/api/v1/entities/drill/maintenance*", async route => {
      if (state === "loading") await held;
      return state === "failed"
        ? route.fulfill({ status: 500, json: { message: "Cannot load maintenance" } })
        : route.fulfill({ json: [{ id: "task", name: "Charge batteries", scheduledDate: "2026-10-10" }] });
    });
    const loaded = page.waitForResponse(response => response.url().includes("/entities/drill/maintenance"));
    await page.goto("/item/drill");
    if (state !== "loading") await loaded;
    await expect(page.getByTestId("item-record")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("item-maintenance-empty")).toHaveCount(0);
    release?.();
    await loaded;
    await expect(page.locator('a[href="/item/drill/maintenance"]')).toHaveText("Maintenance");
  });
}
