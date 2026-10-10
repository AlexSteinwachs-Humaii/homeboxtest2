import { expect, test } from "@playwright/test";

for (const hasTasks of [true, false]) {
  test(`overview leads with capture and search (scheduled tasks: ${hasTasks})`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route("**/api/v1/maintenance?status=scheduled", route =>
      route.fulfill({
        json: hasTasks
          ? [
              {
                id: "later",
                itemID: "purifier",
                name: "Replace air filter",
                itemName: "Air Purifier",
                scheduledDate: "2026-10-10",
                completedDate: "",
                description: "",
                cost: "0",
              },
              {
                id: "earlier",
                itemID: "drill",
                name: "Check battery",
                itemName: "Cordless Drill",
                scheduledDate: "2026-10-08",
                completedDate: "",
                description: "",
                cost: "0",
              },
            ]
          : [],
      })
    );
    const scheduledResponse = page.waitForResponse("**/api/v1/maintenance?status=scheduled");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.fill("input[type='text']", "demo@example.com");
    await page.fill("input[type='password']", "demodemo");
    await page.click("button[type='submit']");
    await expect(page).toHaveURL("/home");
    await scheduledResponse;

    const lead = page.getByTestId("overview-lead");
    await expect(lead.getByRole("heading", { level: 1 })).toHaveText("A little more organized.");
    const reminder = lead.getByTestId("care-reminder");
    if (hasTasks) {
      await expect(reminder).toHaveCount(1);
      await expect(reminder).toContainText("Check battery");
      await expect(reminder).toContainText("Cordless Drill");
      await expect(reminder).toContainText("Due");
      await expect(reminder).toContainText(/Oct(?:ober)? 8(?:th)?, 2026/);
      await expect(reminder).not.toContainText("Replace air filter");
      await reminder.getByRole("link", { name: "View maintenance" }).click();
      await expect(page).toHaveURL("/maintenance");
      await page.goto("/home", { waitUntil: "domcontentloaded" });
    } else {
      // Wait until the scheduled query has finished, not just initial loading.
      await expect(lead.getByRole("searchbox", { name: "Search inventory" })).toBeVisible();
      await expect(reminder).toHaveCount(0);
    }

    await lead.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading")).toContainText("Create");
    await page.keyboard.press("Escape");
    await lead.getByRole("button", { name: "Scan label", exact: true }).click();
    await expect(page).toHaveURL(/\/scanner$/);
    await expect(page.getByRole("heading", { name: "Scan a label" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page).toHaveURL(/\/items$/);
    await page.goto("/home", { waitUntil: "domcontentloaded" });

    await lead.getByRole("searchbox", { name: "Search inventory" }).fill("drill & tools");
    await lead.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/\/items\?q=drill%20%26%20tools$/);
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    await lead.getByRole("searchbox").fill("garage");
    await lead.getByRole("button", { name: "Search inventory", exact: true }).click();
    await expect(page).toHaveURL(/\/items\?q=garage$/);
  });
}
