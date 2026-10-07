import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

for (const denied of [false, true]) {
  test(`scanner ready and manual lookup (camera denied: ${denied})`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.addCookies([{ name: "hb.auth.session", value: "true", url: baseURL! }]);
    await page.addInitScript(deny => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as unknown as Window & { stoppedTracks: number }).stoppedTracks = 0;
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (deny) throw new DOMException("Denied", "NotAllowedError");
        const stream = await original(constraints);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            (window as unknown as Window & { stoppedTracks: number }).stoppedTracks++;
            stop();
          };
        }
        return stream;
      };
    }, denied);
    await page.route("**/api/v1/**", route => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (path === "/status")
        return route.fulfill({ json: { build: { version: "v0.0.0" }, latest: { version: "v0.0.0" } } });
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
      if (path === "/entities") return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 12 } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/items");
    await page.getByRole("button", { name: "Scan label", exact: true }).click();
    await expect(page).toHaveURL(/\/scanner$/);
    await expect(page.getByRole("heading", { name: "Scan a label" })).toBeVisible();
    await expect(page.getByText("Looking in My Home")).toBeVisible();
    await expect(page.getByText("Hold a barcode or QR label inside the frame")).toBeVisible();
    if (!denied) {
      await expect
        .poll(() => page.locator("main video").evaluate((video: HTMLVideoElement) => video.readyState))
        .toBeGreaterThan(1);
    } else {
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await page.getByLabel("Or type the code", { exact: true }).fill("001-024");
    const request = page.waitForRequest(
      req => req.url().includes("/entities?") && new URL(req.url()).searchParams.get("q") === "#001-024"
    );
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await expect(page).toHaveURL(/\/items\?q=%23001-024/);
    await request;
    if (!denied)
      await expect
        .poll(() => page.evaluate(() => (window as unknown as Window & { stoppedTracks: number }).stoppedTracks))
        .toBeGreaterThan(1);
    await page.getByRole("button", { name: "Scan label", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page).toHaveURL(/\/items$/);
  });
}
