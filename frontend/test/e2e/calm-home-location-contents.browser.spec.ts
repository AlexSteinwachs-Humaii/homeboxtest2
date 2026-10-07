import { expect, test } from "@playwright/test";

test("location contents separate places from items, capture here, and preserve the collection", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
  const locationType = { id: "location-type", name: "Location", isLocation: true };
  const itemType = { id: "item-type", name: "Item", isLocation: false };
  const garage = { id: "garage", name: "Garage", itemCount: 1, entityType: locationType };
  const shelf = { id: "shelf", name: "Tool Shelf", itemCount: 1, entityType: locationType };
  const box = { id: "box", name: "Parts box", itemCount: 1, entityType: locationType };
  const item = (id: string, name: string, parent: typeof garage) => ({
    id,
    name,
    parent,
    entityType: itemType,
    quantity: 1,
    assetId: "001-001",
    tags: [],
    purchasePrice: 0,
  });
  const drill = item("drill", "Cordless Drill", shelf);
  const cord = item("cord", "Extension cord", garage);
  const screw = item("screw", "Screws", box);
  const queries: string[][] = [];
  const writes: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() !== "GET" && path !== "/users/self/settings") {
      writes.push(`${request.method()} ${path}`);
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
    if (path === "/entity-types") return route.fulfill({ json: [itemType, locationType] });
    if (path === "/entities/tree")
      return route.fulfill({
        json: [
          {
            ...garage,
            type: "location",
            children: [{ ...shelf, type: "location", children: [{ ...box, type: "location", children: [] }] }],
          },
        ],
      });
    if (path === "/entities/garage" || path === "/entities/shelf") {
      // Delay the location to catch queries made before its children are known.
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({
        json: {
          ...(path.endsWith("garage") ? garage : shelf),
          children: path.endsWith("garage") ? [shelf] : [box],
          attachments: [],
          fields: [],
          tags: [],
          notes: "",
          description: "",
        },
      });
    }
    if (path === "/entities") {
      if (url.searchParams.get("isLocation") === "true")
        return route.fulfill({ json: { items: [garage, shelf, box], total: 3 } });
      const ids = url.searchParams.getAll("parentIds");
      if (ids.length) queries.push(ids);
      const items = [drill, cord, screw].filter(item => ids.includes(item.parent.id));
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 100 } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/location/garage");
  const places = page.getByTestId("nested-locations");
  const items = page.getByTestId("location-items");
  await expect(places.getByRole("link", { name: /Tool Shelf/ })).toBeVisible();
  await expect(items.getByTestId("item-card")).toHaveCount(2);
  await expect(items.getByTestId("item-card").filter({ hasText: "Cordless Drill" })).toContainText("Tool Shelf");
  await expect(items.getByTestId("item-card").filter({ hasText: "Extension cord" })).toContainText("Garage");
  await expect(items).not.toContainText("Screws");
  expect(queries[0]).toEqual(["garage", "shelf"]);
  expect(
    await places.evaluate(
      (el, items) => !!(el.compareDocumentPosition(items as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await items.elementHandle()
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Place inside", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("combobox").filter({ hasText: "Garage" })).toContainText("Garage");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add item here", exact: true }).click();
  await expect(page).toHaveURL(/\/item\/new\?location=garage$/);
  await expect(page.getByTestId("add-item-page").getByRole("combobox").first()).toContainText("Garage");
  await page.goBack();
  await places.getByRole("link", { name: /Tool Shelf/ }).click();
  await expect(page).toHaveURL(/\/location\/shelf$/);
  await expect(places.getByRole("link", { name: /Parts box/ })).toBeVisible();
  await expect(items.getByTestId("item-card")).toHaveCount(2);
  await expect(items.getByTestId("item-card").filter({ hasText: "Screws" })).toContainText("Parts box");
  await expect(items).not.toContainText("Extension cord");
  expect(queries).toContainEqual(["shelf", "box"]);
  await page.getByRole("link", { name: "Back to Locations", exact: true }).click();
  await expect(page).toHaveURL(/\/locations$/);
  await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Select Collection", exact: true })).toContainText("My Home");
  expect(writes).toEqual([]);
});
