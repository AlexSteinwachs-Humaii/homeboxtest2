import { expect, test } from "@playwright/test";

for (const legacyHeader of [false, true]) {
  test(`desktop shell actions (legacy header preference: ${legacyHeader})`, async ({ page }) => {
    test.slow(); // Allow Nuxt's first route compilation on a cold dev server.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(legacy => {
      localStorage.setItem("homebox/preferences/location", JSON.stringify({ displayLegacyHeader: legacy }));
    }, legacyHeader);
    await page.goto("/");
    await page.fill("input[type='text']", "demo@example.com");
    await page.fill("input[type='password']", "demodemo");
    await page.click("button[type='submit']");
    await expect(page).toHaveURL("/home");

    const actions = page.getByTestId("desktop-shell-actions");
    await expect(actions).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("mobile-shell-header")).toBeHidden();
    await expect(actions.locator("a")).toHaveCount(0);
    await expect(page.locator("[data-sidebar='content']").getByText("Scanner", { exact: true })).toBeHidden();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(249, 248, 246)");
    await expect(actions.locator("[data-sidebar='trigger'] svg")).toHaveCSS("color", "rgb(39, 43, 41)");
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(actions.getByRole("button", { name: "Add item", exact: true })).toBeInViewport();
    await actions.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "Toggle Sidebar" }).click();

    await actions.getByRole("searchbox").fill("drill & tools");
    await actions.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/items\?q=drill%20%26%20tools$/);
    await expect(actions.getByRole("searchbox")).toHaveValue("");
    await actions.getByRole("searchbox").fill("garage");
    await actions.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/\/items\?q=garage$/);

    await actions.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page).toHaveURL(/\/item\/new$/);
    await expect(page.getByRole("heading", { name: "Add an item" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/items$/);
    await actions.getByRole("button", { name: "Scan label", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator("video")).toBeVisible();
    await page.keyboard.press("Escape");

    // The existing header returns at every width below lg, including tablets.
    for (const width of [1023, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(actions).toBeHidden();
      const mobileHeader = page.getByTestId("mobile-shell-header");
      await expect(mobileHeader).toBeVisible();
      await expect(mobileHeader.getByRole("searchbox")).toBeVisible();
      await mobileHeader.getByRole("searchbox").fill("mobile search");
      await mobileHeader.getByRole("searchbox").press("Enter");
      await expect(page).toHaveURL(/\/items\?q=mobile%20search$/);
    }
  });
}
