import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 390]) {
  test(`Home inventory export progress, failure, and retry at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const email = `csv-${Date.now()}-${width}@example.com`;
    const password = "CSV-Export-Test-Password123!";
    const registration = await request.post("/api/v1/users/register", {
      data: { email, password, name: "CSV export test", token: "" },
    });
    expect(registration.status()).toBe(204);
    await page.goto("/");
    await page.fill("input[type='text']", email);
    await page.fill("input[type='password']", password);
    await page.click("button[type='submit']");
    await expect(page).toHaveURL("/home");

    const button = page.getByRole("button", { name: "Export inventory CSV" });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    let attempts = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route("**/api/v1/reporting/dashboard-inventory", async route => {
      attempts++;
      if (attempts === 1) {
        await held;
        await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"failed"}' });
      } else {
        await route.fulfill({ status: 200, contentType: "text/csv", body: "HB.name\n" });
      }
    });
    let downloads = 0;
    page.on("download", () => downloads++);
    await button.click();
    const busy = page.getByRole("button", { name: "Preparing inventory CSV…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    // Even a programmatic duplicate activation must not issue another request.
    await busy.evaluate(element => (element as HTMLButtonElement).click());
    expect(attempts).toBe(1);
    release();
    await expect(
      page.getByText("Could not export inventory. Check your connection and try Export inventory CSV again.")
    ).toBeVisible();
    await expect(button).toBeEnabled();
    expect(downloads).toBe(0);
    const downloaded = page.waitForEvent("download");
    await button.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe("homebox-dashboard-inventory.csv");
    expect(await readFile((await file.path())!, "utf8")).toBe("HB.name\n");
    await expect(button).toBeEnabled();
    expect(attempts).toBe(2);
  });
}
