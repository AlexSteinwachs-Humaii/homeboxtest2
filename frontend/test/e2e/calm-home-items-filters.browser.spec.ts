import { expect, test } from "@playwright/test";

// Mock only the API, not the page: verify that controls send server queries and
// render the paginated response rather than filtering the currently shown cards.
test("items filters stay beside search and persist across pages", async ({ page, context, baseURL }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 980 });
  await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
  await page.addInitScript(() => {
    localStorage.setItem("homebox/preferences/location", JSON.stringify({ itemsPerTablePage: 1 }));
  });
  const items = [
    { id: "drill", name: "Drill", insured: true },
    { id: "tent", name: "Tent", insured: false },
    { id: "bike", name: "Bike", insured: true },
  ].map(item => ({
    ...item,
    parent: { id: "garage", name: "Garage" },
    tags: [],
    description: "",
    archived: false,
    assetId: "001-024",
    quantity: 1,
    purchasePrice: "0",
  }));
  let latest = new URLSearchParams();
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
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
    if (path === "/groups") return route.fulfill({ json: { id: "home", name: "My Home", currency: "USD" } });
    if (path === "/groups/all") return route.fulfill({ json: [{ id: "home", name: "My Home", currency: "USD" }] });
    if (path === "/tags") return route.fulfill({ json: [{ id: "tools", name: "Tools" }] });
    if (path === "/entities/tree") return route.fulfill({ json: [{ id: "garage", name: "Garage", children: [] }] });
    if (path === "/entities") {
      if (url.searchParams.get("isLocation") === "true")
        return route.fulfill({ json: { items: [{ id: "garage", name: "Garage" }] } });
      latest = url.searchParams;
      const filtered = items.filter(item => !latest.has("insured") || String(item.insured) === latest.get("insured"));
      const current = Number(latest.get("page") || 1);
      return route.fulfill({
        json: { items: filtered.slice(current - 1, current), total: filtered.length, page: current, pageSize: 1 },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/items?page=2", { waitUntil: "domcontentloaded" });
  const search = page.getByRole("textbox", { name: "Search", exact: true });
  const cards = page.getByTestId("item-card");
  await expect(cards).toContainText("Tent");
  await expect.poll(() => latest.has("insured")).toBe(false);

  for (const name of ["Locations", "Tags", "Has photo", "Not archived", "Insured"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(search).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await search.fill("drill");
  await expect.poll(() => latest.get("q")).toBe("drill");
  await page.getByRole("button", { name: "Insured", exact: true }).click();
  await page.getByRole("combobox", { name: "Insured", exact: true }).click();
  await page.getByRole("option", { name: "Insured", exact: true }).click();
  await expect(cards).toContainText("Drill");
  await expect.poll(() => latest.get("insured")).toBe("true");
  await expect.poll(() => latest.get("page")).toBe("1");
  await expect(search).toHaveValue("drill");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Page 2", exact: true }).first().click();
  await expect(cards).toContainText("Bike");
  await expect.poll(() => latest.get("page")).toBe("2");
  await expect.poll(() => latest.get("insured")).toBe("true");
  await page.reload();
  await expect(cards).toContainText("Bike");
  await expect(search).toHaveValue("drill");

  await page.getByRole("button", { name: "Insured", exact: true }).click();
  await page.getByRole("combobox", { name: "Insured", exact: true }).click();
  await page.getByRole("option", { name: "Not insured", exact: true }).click();
  await expect(cards).toContainText("Tent");
  await expect.poll(() => latest.get("insured")).toBe("false");
  await page.getByRole("combobox", { name: "Insured", exact: true }).click();
  await page.getByRole("option", { name: "All items", exact: true }).click();
  await expect.poll(() => latest.has("insured")).toBe(false);
  await page.keyboard.press("Escape");

  // Existing name, tag/label text and asset-ID syntax reach the same server
  // search parameter, with no new insurance constraint when cleared.
  for (const query of ["Drill", "Tools", "label text", "#001-024", "drill"]) {
    await search.fill(query);
    await expect.poll(() => latest.get("q")).toBe(query);
    await expect.poll(() => latest.has("insured")).toBe(false);
  }

  await page.getByRole("button", { name: "Has photo", exact: true }).click();
  await page.getByRole("switch", { name: "Only items with photo", exact: true }).click();
  await expect.poll(() => latest.get("onlyWithPhoto")).toBe("true");
  await page.getByRole("switch", { name: "Only items without photo", exact: true }).click();
  await expect.poll(() => latest.get("onlyWithoutPhoto")).toBe("true");
  await expect.poll(() => latest.get("onlyWithPhoto")).toBe("false");
  await page.getByRole("switch", { name: "Only items without photo", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Not archived", exact: true }).click();
  await page.getByRole("switch", { name: "Not archived", exact: true }).click();
  await expect.poll(() => latest.get("includeArchived")).toBe("true");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByRole("dialog").getByText("Garage", { exact: true }).click();
  await expect.poll(() => latest.getAll("parentIds")).toEqual(["garage"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByRole("dialog").getByText("Tools", { exact: true }).click();
  await expect.poll(() => latest.getAll("tags")).toEqual(["tools"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.getByText("Field Selector", { exact: true })).toBeVisible();
  await expect(page.getByText("Negate Selected Tags", { exact: true })).toBeVisible();
  await expect(page.getByText("Order By", { exact: true }).first()).toBeVisible();
  await page.getByText("Field Selector", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Custom Fields", { exact: true }).first()).toBeVisible();
  await expect(search).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/calm-home-items-filters.png", fullPage: true });
});
