import { expect, test } from "@playwright/test";

for (const { priceFails, withPrice, withAdvanced, withParent } of [
  { priceFails: false, withPrice: false, withAdvanced: false, withParent: false },
  { priceFails: false, withPrice: true, withAdvanced: true, withParent: true },
  { priceFails: false, withPrice: false, withAdvanced: true, withParent: false },
  { priceFails: true, withPrice: false, withAdvanced: true, withParent: true },
  { priceFails: true, withPrice: true, withAdvanced: false, withParent: false },
]) {
  test(`short capture writes only on Save (price: ${withPrice}, advanced: ${withAdvanced}, parent: ${withParent}, failure: ${priceFails})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 980 });
    await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
    const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
    const location = { id: "closet", name: "Closet" };
    const parentItem = { id: "camping-box", name: "Camping box" };
    let item = {
      id: "sleeping-bag",
      name: "Sleeping bag",
      quantity: 1,
      description: "Blue sack",
      parent: location,
      entityType: { id: "item-type", name: "Item", isLocation: false },
      tags: [],
      attachments: [],
      fields: [],
      insured: false,
      archived: false,
      purchasePrice: 0,
      assetId: "001-001",
      notes: "",
      serialNumber: "",
      manufacturer: "",
      modelNumber: "",
    };
    await page.route("**/api/v1/**", route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1", "");
      if (path.startsWith("/entities") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        writes.push({ method: request.method(), path, body: request.postDataJSON() });
        if (path === "/entities") {
          const body = request.postDataJSON();
          item = { ...item, ...body, parent: body.parentId === parentItem.id ? parentItem : location };
          return route.fulfill({ json: item });
        }
        if (priceFails) return route.fulfill({ status: 500, json: { message: "Price failed" } });
        return route.fulfill({ json: item });
      }
      if (path === "/status")
        return route.fulfill({ json: { build: { version: "v0.0.0" }, latest: { version: "v0.0.0" } } });
      if (path === "/users/self")
        return route.fulfill({
          json: { item: { id: "user", name: "Alex", groupId: "home", group: { id: "home", name: "My Home" } } },
        });
      if (path === "/users/self/settings") return route.fulfill({ json: { item: {} } });
      if (path === "/groups") return route.fulfill({ json: { id: "home", name: "My Home", currency: "USD" } });
      if (path === "/groups/all") return route.fulfill({ json: [{ id: "home", name: "My Home", currency: "USD" }] });
      if (path === "/entity-types") return route.fulfill({ json: [item.entityType] });
      if (path === "/entities/tree") return route.fulfill({ json: [{ ...location, children: [] }] });
      if (path === "/entities")
        return route.fulfill({
          json: { items: url.searchParams.get("isLocation") === "true" ? [location] : [parentItem], total: 0 },
        });
      if (path === "/entities/sleeping-bag") return route.fulfill({ json: item });
      return route.fulfill({ json: [] });
    });

    await page.goto("/items");
    await page.getByTestId("desktop-shell-actions").getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page).toHaveURL(/\/item\/new$/);
    const form = page.getByTestId("add-item-page");
    await expect(form.getByText("A name and a location are enough to find it later.")).toBeVisible();
    await expect(form.getByText("Items without photos still appear in search.")).toBeVisible();
    const advanced = form.getByTestId("advanced-fields");
    for (const name of [/^Serial Number/, /^Model Number/, /^Manufacturer/]) {
      await expect(advanced.getByRole("textbox", { name })).toBeHidden();
    }
    await expect(advanced.getByRole("combobox", { name: "Parent Item" })).toBeHidden();
    await expect(advanced.getByRole("checkbox", { name: "Insured" })).toBeHidden();
    await advanced.locator("summary").click();
    await advanced.getByRole("textbox", { name: /^Serial Number/ }).fill("Unsaved serial");
    await advanced.getByRole("checkbox", { name: "Insured" }).check();
    await advanced.locator("summary").click();
    await advanced.locator("summary").click();
    await expect(advanced.getByRole("textbox", { name: /^Serial Number/ })).toHaveValue("Unsaved serial");
    await form.getByRole("textbox", { name: /^Name/ }).fill("Unsaved item");
    await form.getByLabel("Add a photo (optional)").setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZsAAAAASUVORK5CYII=",
        "base64"
      ),
    });
    await expect(form.locator("img").first()).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/items$/);
    expect(writes).toEqual([]);

    await page.goto("/home");
    await page.getByTestId("overview-lead").getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page).toHaveURL(/\/item\/new$/);
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(writes).toEqual([]);

    await page.goto("/item/new?location=closet");
    await expect(form.getByRole("combobox").first()).toContainText("Closet");
    await expect(form.getByLabel("Quantity", { exact: true })).toHaveValue("1");
    await form.getByRole("textbox", { name: /^Name/ }).fill("Sleeping bag");
    if (withPrice) await form.getByLabel("Purchase price (optional)").fill("89");
    await form.getByRole("textbox", { name: /^Description/ }).fill("Blue sack");
    if (withAdvanced) {
      await advanced.locator("summary").click();
      await advanced.getByRole("textbox", { name: /^Serial Number/ }).fill("Serial-42");
      await advanced.getByRole("textbox", { name: /^Model Number/ }).fill("Model-7");
      await advanced.getByRole("textbox", { name: /^Manufacturer/ }).fill("Acme");
      await advanced.getByRole("checkbox", { name: "Insured" }).check();
      if (withParent) {
        await advanced.getByRole("combobox", { name: "Parent Item" }).click();
        await page.getByRole("option", { name: "Camping box" }).click();
      }
      // Closing the disclosure must preserve entered values and must not submit.
      await advanced.locator("summary").click();
    }
    expect(writes).toEqual([]);
    await form.getByRole("button", { name: "Save item", exact: true }).click();
    await expect(page).toHaveURL(/\/item\/sleeping-bag$/);
    expect(writes.map(write => write.method)).toEqual(withPrice || withAdvanced ? ["POST", "PUT"] : ["POST"]);
    expect(writes[0]!.body).toEqual({
      name: "Sleeping bag",
      parentId: withParent ? "camping-box" : "closet",
      manufacturer: withAdvanced ? "Acme" : "",
      modelNumber: withAdvanced ? "Model-7" : "",
      quantity: 1,
      description: "Blue sack",
      tagIds: [],
      entityTypeId: "item-type",
    });
    if (withPrice || withAdvanced)
      expect(writes[1]!.body).toMatchObject({
        purchasePrice: withPrice ? 89 : 0,
        serialNumber: withAdvanced ? "Serial-42" : "",
        insured: withAdvanced,
        manufacturer: withAdvanced ? "Acme" : "",
        modelNumber: withAdvanced ? "Model-7" : "",
        parentId: withParent ? "camping-box" : "closet",
        entityTypeId: "item-type",
        tagIds: [],
      });
    if (priceFails)
      await expect(
        page.getByText(
          "The item was saved, but its purchase price, serial number or insurance details could not be saved. You can add them from Edit."
        )
      ).toBeVisible();
  });
}
