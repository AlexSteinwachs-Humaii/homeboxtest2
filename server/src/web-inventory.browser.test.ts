import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

import { startServer } from "./boot.ts";
import { setApiKeyPepper } from "./auth/token.ts";

const repoRoot = resolve(import.meta.dir, "../..");
const migrationsDir = resolve(repoRoot, "backend/internal/data/migrations/sqlite3");
const webDir = resolve(repoRoot, "mobile/dist");
const pepper = "dev-only-pepper-not-for-production-use-32b+";
const enabled = process.env.HBOX_WEB_BROWSER === "1";

type CdpResult = Record<string, unknown>;

class PageSession {
  readonly requests: string[] = [];
  private next = 0;
  private readonly pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void }>();

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: { request?: { url?: string } };
        result?: CdpResult;
        error?: { message: string };
      };
      if (message.id && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result ?? {});
        return;
      }
      if (message.method === "Network.requestWillBeSent") {
        const url = message.params?.request?.url;
        if (url) this.requests.push(url);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = result.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
    if (details) {
      throw new Error(details.exception?.description || details.text || "browser script failed");
    }
    return (result.result as { value?: unknown } | undefined)?.value;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForJson(url: string): Promise<unknown> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = `${response.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function chromiumPath(): string {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  for (const candidate of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next binary
    }
  }
  throw new Error("chromium was not found");
}

const browserTest = enabled ? test : test.skip;

browserTest(
  "the Expo web client signs in and completes inventory tasks against the Bun server",
  async () => {
    const shell = readFileSync(join(webDir, "index.html"), "utf8");
    expect(shell).toContain('name="homebox-client" content="expo-web"');
    const bundleName = shell.match(/src="(\/_expo\/static\/js\/web\/[^"]+)"/)?.[1];
    expect(bundleName).toBeTruthy();
    const bundle = readFileSync(join(webDir, bundleName!), "utf8");
    expect(bundle).toContain("Attach a photo");
    expect(bundle).toContain("New collection");
    expect(bundle).not.toContain("homebox.db");

    const dir = mkdtempSync(join(tmpdir(), "hb-web-"));
    const sqlitePath = join(dir, "homebox.db");
    const photoPath = join(dir, "lamp.jpg");
    writeFileSync(photoPath, await sharp({ create: { width: 16, height: 16, channels: 3, background: "#d1a354" } }).jpeg().toBuffer());
    setApiKeyPepper(pepper);
    const running = await startServer({
      HBOX_DATABASE_SQLITE_PATH: sqlitePath,
      HBOX_MIGRATIONS_DIR: migrationsDir,
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      HBOX_WEB_HOST: "127.0.0.1",
      HBOX_WEB_PORT: "0",
      HBOX_STATIC_DIR: webDir,
      HBOX_STORAGE_CONN_STRING: `file://${dir}`,
      HBOX_STORAGE_PREFIX_PATH: "attachments",
      HBOX_LOG_LEVEL: "error",
    });

    const debugPort = await freePort();
    const userData = join(dir, "chrome");
    let chrome: ChildProcess | null = null;
    let page: PageSession | null = null;
    try {
      const origin = `http://127.0.0.1:${running.server.port}`;
      const registered = await fetch(`${origin}/api/v1/users/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada-web@example.com", password: "secret1" }),
      });
      expect(registered.status).toBe(204);

      chrome = spawn(
        chromiumPath(),
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          `--remote-debugging-port=${debugPort}`,
          `--user-data-dir=${userData}`,
          "--remote-allow-origins=*",
          "about:blank",
        ],
        { stdio: "ignore" },
      );
      const version = (await waitForJson(`http://127.0.0.1:${debugPort}/json/version`)) as { webSocketDebuggerUrl: string };
      const browser = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        browser.addEventListener("open", () => resolve());
        browser.addEventListener("error", () => reject(new Error("browser debugger websocket failed")));
      });
      const created = await new Promise<CdpResult>((resolve, reject) => {
        const id = 1;
        const onMessage = (event: MessageEvent) => {
          const message = JSON.parse(String(event.data)) as { id?: number; result?: CdpResult };
          if (message.id === id) {
            browser.removeEventListener("message", onMessage);
            resolve(message.result ?? {});
          }
        };
        browser.addEventListener("message", onMessage);
        browser.send(JSON.stringify({ id, method: "Target.createTarget", params: { url: "about:blank" } }));
        setTimeout(() => reject(new Error("createTarget timed out")), 10_000);
      });
      const targetId = String(created.targetId ?? "");
      expect(targetId).not.toBe("");
      const list = (await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)) as Array<{
        id: string;
        webSocketDebuggerUrl: string;
      }>;
      const target = list.find((row) => row.id === targetId) ?? list.find((row) => row.webSocketDebuggerUrl);
      expect(target?.webSocketDebuggerUrl).toBeTruthy();
      const socket = new WebSocket(target!.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve());
        socket.addEventListener("error", () => reject(new Error("page websocket failed")));
      });
      page = new PageSession(socket);
      await page.send("Network.enable");
      await page.send("Page.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `window.__fetches = [];
          const orig = window.fetch.bind(window);
          window.fetch = function(input, init) {
            const url = String(input);
            window.__fetches.push(url);
            return orig(input, init).catch((err) => { window.__fetches.push("ERR " + url + " " + err); throw err; });
          };`,
      });
      await page.send("Page.navigate", { url: origin });

      await waitForText(page, "Sign in");
      expect(await fill(page, "Server address", origin)).toBe("ok");
      expect(await fill(page, "Email", "ada-web@example.com")).toBe("ok");
      expect(await fill(page, "Password", "secret1")).toBe("ok");
      await Bun.sleep(100);
      expect(await click(page, "Sign in")).toBe("ok");
      await waitForText(page, "New collection");
      await waitForText(page, "Ada's Home");

      expect(await click(page, "New item")).toBe("ok");
      await waitForText(page, "Save to server");
      expect(await fill(page, "Name", "Café lamp")).toBe("ok");
      expect(await click(page, "Save to server")).toBe("ok");
      await waitForText(page, "No photo on the server yet.");
      await setFile(page, 'input[aria-label="Attach a photo"]', photoPath);
      await waitForText(page, "lamp.jpg");

      expect(await fill(page, "Maintenance name", "Replace bulb")).toBe("ok");
      expect(await click(page, "Schedule maintenance")).toBe("ok");
      await waitForText(page, "Scheduled on the server");
      const lampId = String(await page.evaluate("document.body.innerText")).match(/Server id\s+([0-9a-f-]{36})/i)?.[1];
      expect(lampId).toMatch(/^[0-9a-f-]{36}$/);

      expect(await click(page, "Items")).toBe("ok");
      await waitForText(page, "New item");
      expect(await fill(page, "Search items", "café")).toBe("ok");
      await waitForFetch(page, "q=caf");
      await waitForText(page, "Café lamp", 8_000);
      expect(await fill(page, "Search items", "cafe")).toBe("ok");
      await waitForFetch(page, "q=cafe");
      await waitForText(page, "Café lamp", 8_000);
      const afterSearch = String(await page.evaluate("document.body.innerText"));
      expect(afterSearch).not.toContain("No items match");

      expect(await click(page, "New collection")).toBe("ok");
      expect(await fill(page, "Collection name", "Cabin")).toBe("ok");
      expect(await click(page, "Create collection")).toBe("ok");
      await waitForText(page, "No items in this collection yet.");
      const cabinList = String(await page.evaluate("document.body.innerText"));
      expect(cabinList).toContain("Cabin");
      expect(cabinList).not.toContain("Café lamp");

      expect(await click(page, "New item")).toBe("ok");
      await waitForText(page, "Save to server");
      expect(await fill(page, "Name", "Cabin stool")).toBe("ok");
      expect(await click(page, "Save to server")).toBe("ok");
      await waitForText(page, "Cabin stool");
      const stoolId = String(await page.evaluate("document.body.innerText")).match(/Server id\s+([0-9a-f-]{36})/i)?.[1];
      expect(stoolId).toMatch(/^[0-9a-f-]{36}$/);
      expect(stoolId).not.toBe(lampId);

      expect(await click(page, "Items")).toBe("ok");
      expect(await click(page, "Switch to Ada's Home")).toBe("ok");
      await waitForText(page, "Café lamp");
      const homeList = String(await page.evaluate("document.body.innerText"));
      expect(homeList).not.toContain("Cabin stool");

      const hidden = (await page.evaluate(`(async () => {
        const session = JSON.parse(localStorage.getItem("homebox.session") || "{}");
        const group = localStorage.getItem("homebox.collection");
        const response = await fetch("/api/v1/entities/${stoolId}", {
          headers: { Authorization: session.token, "X-Tenant": group, Accept: "application/json" },
        });
        return { status: response.status, group, url: response.url };
      })()`)) as { status: number; group: string; url: string };
      expect(hidden.status).not.toBe(200);
      expect(hidden.url).toContain("/api/v1/entities/");
      expect(hidden.url).not.toContain("homebox.db");

      expect(await click(page, "Maintenance")).toBe("ok");
      await waitForText(page, "Replace bulb");
      // A direct Vue-era address must load data too, not just render an empty screen.
      await page.send("Page.navigate", { url: `${origin}/maintenance` });
      await waitForText(page, "Replace bulb");
      expect(await click(page, "Mark complete")).toBe("ok");
      await waitForText(page, "Complete");

      const lamp = running.db.query(`SELECT id, name FROM entities WHERE name = ?`).get("Café lamp") as { name: string } | null;
      expect(lamp?.name).toBe("Café lamp");
      const attachment = running.db
        .query(
          `SELECT a.type, a.title FROM attachments a
           JOIN entities e ON e.id = a.entity_attachments OR e.id = a.entity_attachments
           WHERE e.name = ? AND a.type = 'photo'`,
        )
        .get("Café lamp") as { type: string; title: string } | null;
      expect(attachment?.type).toBe("photo");
      expect(attachment?.title).toContain("lamp.jpg");
      const maintenance = running.db
        .query(
          `SELECT m.name, m.date FROM maintenance_entries m
           JOIN entities e ON e.id = m.entity_id
           WHERE e.name = ? AND m.name = ?`,
        )
        .get("Café lamp", "Replace bulb") as { name: string; date: string | null } | null;
      expect(maintenance?.name).toBe("Replace bulb");
      expect(maintenance?.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
      const stoolRow = running.db.query(`SELECT name FROM entities WHERE name = ?`).get("Cabin stool") as { name: string } | null;
      expect(stoolRow?.name).toBe("Cabin stool");

      expect(await click(page, "Items")).toBe("ok");
      expect(await click(page, "Tools")).toBe("ok");
      for (const title of ["Labels", "QR", "CSV import/export", "Collection import/export", "Profile", "Collection settings", "Members", "Invites", "Notifiers", "Entity types", "Templates", "Tags"]) {
        expect(await click(page, `Open ${title}`)).toBe("ok");
        await waitForText(page, title);
        if (title === "QR") {
          expect(await click(page, "Make QR code")).toBe("ok");
          await waitForFetch(page, "/api/v1/qrcode");
          const started = Date.now();
          while (Date.now() - started < 8_000 && !(await page.evaluate("!!document.querySelector('[aria-label=\"QR code\"]')"))) {
            await Bun.sleep(100);
          }
          expect(await page.evaluate("!!document.querySelector('[aria-label=\"QR code\"]')")).toBe(true);
        }
        if (title === "Tags") await waitForText(page, "Tags is not in this release.");
        if (title === "Profile") {
          await waitForText(page, "Theme is not in this release.");
          expect(await click(page, "Delete account")).toBe("ok");
          await waitForText(page, "Permanently delete your account?");
          expect(await click(page, "Cancel account deletion")).toBe("ok");
          expect(await click(page, "Save profile")).toBe("ok");
          await waitForText(page, "Profile saved on the server.");
        }
        expect(await click(page, "All tools")).toBe("ok");
      }
      await page.send("Page.navigate", { url: `${origin}/collection/settings` });
      await waitForText(page, "Save collection settings");
      // This page must load the resolved collection rather than start with an empty form.
      const loadedAt = Date.now();
      while (Date.now() - loadedAt < 8_000 && await page.evaluate("document.querySelector('[aria-label=\"Collection name\"]')?.value") !== "Ada's Home") {
        await Bun.sleep(100);
      }
      expect(await page.evaluate("document.querySelector('[aria-label=\"Collection name\"]')?.value")).toBe("Ada's Home");

      const bad = page.requests.filter((url) => url.includes("homebox.db") || /\/api\/(?!v1)/.test(url));
      expect(bad).toEqual([]);
      expect(page.requests.some((url) => url.includes("/api/v1/users/login"))).toBe(true);
      expect(page.requests.some((url) => url.includes("/api/v1/entities"))).toBe(true);
    } finally {
      try {
        page?.ws.close();
      } catch {
        // The page socket may already be closed.
      }
      chrome?.kill("SIGKILL");
      running.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 180_000 },
);

async function waitForFetch(page: PageSession, part: string, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  let last: unknown = [];
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate("window.__fetches || []");
    if (Array.isArray(last) && last.some((url) => String(url).includes(part))) return;
    await Bun.sleep(200);
  }
  throw new Error(`timed out waiting for fetch ${part}: ${JSON.stringify(last)}`);
}

async function waitForText(page: PageSession, needle: string, timeoutMs = 20_000): Promise<string> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    last = String(await page.evaluate("document.body ? document.body.innerText : ''"));
    if (last.includes(needle)) return last;
    await Bun.sleep(250);
  }
  const extra = await page.evaluate("({ fetches: window.__fetches || [], origin: location.origin })").catch((err: unknown) => String(err));
  throw new Error(`timed out waiting for ${JSON.stringify(needle)}\n---\n${last.slice(0, 1800)}\n---\n${JSON.stringify(extra)}\nrequests:${page.requests.slice(-15).join("\n")}`);
}

async function fill(page: PageSession, label: string, value: string): Promise<string> {
  return String(
    await page.evaluate(`(() => {
      const label = ${JSON.stringify(label)};
      const value = ${JSON.stringify(value)};
      const el = document.querySelector('[aria-label="' + label + '"]');
      if (!el) return "missing " + label;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) return "no setter";
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue(value + " ");
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === value ? "ok" : "value " + el.value;
    })()`),
  );
}

async function click(page: PageSession, name: string): Promise<string> {
  return String(
    await page.evaluate(`(() => {
      const want = ${JSON.stringify(name)};
      const nodes = [...document.querySelectorAll('[role="button"],button,a')];
      const el = nodes.find((node) => {
        const label = node.getAttribute("aria-label") || "";
        const text = (node.textContent || "").replace(/\\s+/g, " ").trim();
        return label === want || text === want;
      });
      if (!el) {
        return "missing " + want + " :: " + nodes.map((node) => node.getAttribute("aria-label") || (node.textContent || "").trim()).filter(Boolean).slice(0, 40).join(" | ");
      }
      el.scrollIntoView({ block: "center" });
      el.click();
      return "ok";
    })()`),
  );
}

async function setFile(page: PageSession, selector: string, filePath: string): Promise<void> {
  const document = await page.send("DOM.getDocument", { depth: 1 });
  const root = (document.root as { nodeId: number }).nodeId;
  const found = await page.send("DOM.querySelector", { nodeId: root, selector });
  const nodeId = Number(found.nodeId);
  if (!nodeId) throw new Error(`file input not found: ${selector}`);
  await page.send("DOM.setFileInputFiles", { nodeId, files: [filePath] });
}
