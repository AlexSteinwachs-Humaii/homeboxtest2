import { expect, test } from "@playwright/test";

test("parent location cards show counts, search, open and create locations", async ({ page, context, baseURL }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 980 });
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
  const locationType = { id: "location-type", name: "Location", isLocation: true };
  const parents = [
    { id: "garage", name: "Garage", itemCount: 2 },
    { id: "box", name: "Box" },
  ];
  const shelf = { id: "shelf", name: "Tool Shelf" };
  let created: Record<string, unknown> | undefined;
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/status")
      return route.fulfill({ json: { build: { version: "v0.0.0" }, latest: { version: "v0.0.0" } } });
    if (path === "/users/self")
      return route.fulfill({
        json: { item: { id: "user", name: "Alex", groupId: "home", group: { id: "home", name: "My Home" } } },
      });
    if (path === "/users/self/settings") return route.fulfill({ json: { item: {} } });
    if (path === "/groups") return route.fulfill({ json: { id: "home", name: "My Home", currency: "USD" } });
    if (path === "/groups/all") return route.fulfill({ json: [{ id: "home", name: "My Home", currency: "USD" }] });
    if (path === "/entity-types") return route.fulfill({ json: [locationType] });
    if (path === "/entities/tree")
      return route.fulfill({
        json: [
          {
            ...parents[0],
            type: "location",
            children: [
              { ...shelf, type: "location", children: [] },
              { id: "drill", name: "Drill", type: "item", children: [] },
            ],
          },
          { ...parents[1], type: "location", children: [] },
        ],
      });
    if (path === "/entities" && route.request().method() === "POST") {
      created = route.request().postDataJSON();
      parents.push({ id: "attic", name: String(created!.name), itemCount: 0 });
      return route.fulfill({ json: { ...created, id: "attic", entityType: locationType } });
    }
    if (path === "/entities")
      return route.fulfill({
        json: { items: url.searchParams.get("filterChildren") === "true" ? parents : [...parents, shelf], total: 3 },
      });
    if (path === "/entities/garage")
      return route.fulfill({
        json: { ...parents[0], children: [shelf], entityType: locationType, attachments: [], fields: [], tags: [] },
      });
    return route.fulfill({ json: [] });
  });

  await page.goto("/locations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
  const cards = page.getByTestId("location-card");
  await expect(cards).toHaveCount(2);
  const garage = cards.filter({ hasText: "Garage" });
  await expect(garage.getByText("2 items", { exact: true })).toBeVisible();
  await expect(garage).toContainText("1 inside · Tool Shelf");
  await expect(garage).not.toContainText("Drill");
  const box = cards.filter({ hasText: "Box" });
  await expect(box.getByText("0 items", { exact: true })).toBeVisible();
  await expect(box).toContainText("No nested locations");
  await expect(page.getByText("Unlocated", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: "test-results/calm-home-locations.png", fullPage: true });

  const search = page.getByRole("searchbox", { name: "Find a location" });
  await search.fill("GAR");
  await expect(cards).toHaveCount(1);
  await search.fill("nothing matches");
  await expect(cards).toHaveCount(0);
  await expect(page.getByText("No Locations Found", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(cards).toHaveCount(2);

  await page.getByRole("button", { name: "Add location", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /^Location Name/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await garage.getByRole("link").click();
  await expect(page).toHaveURL(/\/location\/garage\/?$/);

  await page.goto("/locations");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await dialog.getByRole("textbox", { name: /^Location Name/ }).fill("Attic");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/location\/attic\/?$/);
  expect(created).toMatchObject({ name: "Attic", entityTypeId: "location-type" });
  await page.goto("/locations");
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "Attic" })).toContainText("0 items");
});
