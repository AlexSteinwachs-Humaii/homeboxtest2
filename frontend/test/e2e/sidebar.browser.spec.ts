import { expect, test } from "@playwright/test";

test("desktop sidebar groups existing collection destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.context().addCookies([{ name: "sidebar:state", value: "true", url: test.info().project.use.baseURL! }]);
  await page.goto("/home");
  await page.fill("input[type='text']", "demo@example.com");
  await page.fill("input[type='password']", "demodemo");
  await page.click("button[type='submit']");
  await expect(page).toHaveURL("/home");

  const primary = page.getByTestId("primary-navigation");
  const secondary = page.getByTestId("secondary-navigation");
  await expect(primary.getByRole("link")).toHaveText(["Overview", "Items", "Locations", "Maintenance"]);
  await expect(secondary.getByRole("link")).toHaveText(["Tools", "Settings"]);
  const collectionSelector = page.getByRole("combobox", { name: "Select collection" });
  await expect(collectionSelector).toHaveText(/Demo's Home/);
  await collectionSelector.click();
  await expect(page.getByRole("option", { name: "Demo's Home", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Demo's Home", exact: true }).click();
  await expect(collectionSelector).toHaveAttribute("aria-expanded", "false");

  await secondary.getByRole("button", { name: "Tools", exact: true }).click();
  for (const href of ["/tags", "/templates", "/collection/tools"]) {
    await expect(secondary.locator(`a[href='${href}']`).last()).toBeVisible();
  }
  await secondary.getByRole("button", { name: "Settings", exact: true }).click();
  for (const href of [
    "/profile",
    "/collection/members",
    "/collection/invites",
    "/collection/notifiers",
    "/collection/settings",
    "/collection/entity-types",
  ]) {
    await expect(secondary.locator(`a[href='${href}']`).last()).toBeVisible();
  }
  await expect(secondary.getByRole("link", { name: "Notifiers", exact: true })).toBeVisible();

  await primary.getByRole("link", { name: "Items", exact: true }).click();
  await expect(page).toHaveURL("/items");
  await page.locator("input[type='search']").first().fill("Rocker");
  await page.locator("input[type='search']").first().press("Enter");
  await expect(page).toHaveURL("/items?q=Rocker");
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL("/");
});
