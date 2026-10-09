import { connect } from "node:net";

import { validateNotifierUrl } from "./notifier.ts";

export type NotifierDelivery = { url: string; message: string; at: string };

const deliveries: NotifierDelivery[] = [];

export function recentNotifierDeliveries(): NotifierDelivery[] {
  return deliveries.slice();
}

// Delivers a notifier message. logger:// is the shoutrrr log transport.
// generic/http(s) posts the text. smtp:// speaks a short SMTP dialogue.
// Other allowlisted schemes are refused rather than reported as sent.
export async function sendNotifierMessage(url: string, message: string): Promise<void> {
  const raw = url.trim();
  await validateNotifierUrl(raw);
  const scheme = raw.slice(0, raw.indexOf("://")).toLowerCase().split("+")[0];
  if (scheme === "logger") {
    console.info(`[homebox] notifier delivered logger: ${message}`);
    remember(raw, message);
    return;
  }
  if (scheme === "generic" || scheme === "http" || scheme === "https") {
    await postGeneric(raw, message);
    remember(raw, message);
    return;
  }
  if (scheme === "smtp") {
    await sendSmtp(raw, message);
    remember(raw, message);
    return;
  }
  throw new Error(`unsupported notifier scheme "${scheme}" cannot be delivered`);
}

function remember(url: string, message: string): void {
  deliveries.push({ url, message, at: new Date().toISOString() });
  if (deliveries.length > 200) deliveries.shift();
}

function genericTarget(url: string): string {
  const at = url.indexOf("://");
  const scheme = url.slice(0, at).toLowerCase();
  const rest = url.slice(at + 3);
  if (scheme === "http" || scheme === "https") return url;
  const [service, transport] = scheme.split("+");
  if (service !== "generic") throw new Error("not a generic notifier URL");
  if (transport === "http" || transport === "https") return `${transport}://${rest}`;
  if (rest.toLowerCase().startsWith("http://") || rest.toLowerCase().startsWith("https://")) return rest;
  return `https://${rest}`;
}

async function postGeneric(url: string, message: string): Promise<void> {
  const target = genericTarget(url);
  await validateNotifierUrl(url);
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: message,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("notifier redirect was refused");
  }
  if (!response.ok) throw new Error(`notifier delivery failed: ${response.status}`);
}

async function sendSmtp(url: string, message: string): Promise<void> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 587;
  if (!host || !Number.isFinite(port)) throw new Error("smtp notifier URL is missing a host");
  const params = parsed.searchParams;
  const from = params.get("from") || params.get("fromAddress") || decodeURIComponent(parsed.username || "");
  const to = (params.get("to") || params.get("toAddresses") || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!from || to.length === 0) throw new Error("smtp notifier URL needs from and to addresses");
  const user = decodeURIComponent(parsed.username || "");
  const pass = decodeURIComponent(parsed.password || "");
  await smtpDialogue(host, port, { from, to, user, pass, message });
}

function smtpDialogue(
  host: string,
  port: number,
  mail: { from: string; to: string[]; user: string; pass: string; message: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = "";
    const queue = [
      `EHLO homebox`,
      ...(mail.user ? [`AUTH LOGIN`, b64(mail.user), b64(mail.pass)] : []),
      `MAIL FROM:<${mail.from}>`,
      ...mail.to.map((address) => `RCPT TO:<${address}>`),
      `DATA`,
      `Subject: Homebox\r\nTo: ${mail.to.join(", ")}\r\nFrom: ${mail.from}\r\n\r\n${mail.message}\r\n.`,
      `QUIT`,
    ];
    let step = 0;
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("smtp notifier timed out")), 10_000);
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\n")) return;
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      buffer = "";
      const last = lines[lines.length - 1] ?? "";
      const code = Number(last.slice(0, 3));
      if (!Number.isFinite(code) || code >= 400) {
        clearTimeout(timer);
        fail(new Error(`smtp notifier rejected the message: ${last}`));
        return;
      }
      if (step >= queue.length) {
        clearTimeout(timer);
        socket.end();
        resolve();
        return;
      }
      socket.write(`${queue[step++]}\r\n`);
    });
  });
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export async function sendDueMaintenance(db: import("bun:sqlite").Database): Promise<number> {
  const today = localDate();
  const groups = db.query(`SELECT id FROM groups`).all() as Array<{ id: unknown }>;
  let sent = 0;
  for (const group of groups) {
    const id = readGroupId(group.id);
    if (!id) continue;
    const [bytes, text] = idPair(id);
    const entries = db
      .query(
        `SELECT m.name FROM maintenance_entries m
         JOIN entities e ON e.id = m.entity_id
         WHERE (e.group_entities = ? OR e.group_entities = ?)
           AND m.scheduled_date IS NOT NULL
           AND (m.date IS NULL OR m.date = '')
           AND substr(m.scheduled_date, 1, 10) = ?`,
      )
      .all(bytes, text, today) as Array<{ name: string }>;
    if (entries.length === 0) continue;
    const notifiers = db
      .query(
        `SELECT url FROM notifiers WHERE (group_id = ? OR group_id = ?) AND is_active = 1`,
      )
      .all(bytes, text) as Array<{ url: string }>;
    if (notifiers.length === 0) continue;
    const message = `Homebox Maintenance for (${today}):\n${entries.map((entry) => ` - ${entry.name}`).join("\n")}\n`;
    for (const notifier of notifiers) {
      const key = `${id}:${today}:${notifier.url}`;
      if (sentToday.has(key)) continue;
      try {
        await sendNotifierMessage(notifier.url, message);
        sentToday.add(key);
        sent += 1;
      } catch (err) {
        console.warn(`[homebox] due notifier failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return sent;
}

const sentToday = new Set<string>();

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function readGroupId(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array && value.byteLength === 16) {
    const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return null;
}

function idPair(id: string): [Uint8Array, string] {
  const text = id.toLowerCase();
  const hex = text.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return [out, text];
}

let dueTimer: ReturnType<typeof setInterval> | undefined;
let dueStart: ReturnType<typeof setTimeout> | undefined;

export function startDueNotifiers(db: import("bun:sqlite").Database): void {
  stopDueNotifiers();
  const run = () => {
    void sendDueMaintenance(db).catch((err) => {
      console.warn(`[homebox] due maintenance notifier failed: ${err instanceof Error ? err.message : err}`);
    });
  };
  dueStart = setTimeout(run, 1500);
  dueStart.unref?.();
  dueTimer = setInterval(run, 60 * 60 * 1000);
  dueTimer.unref?.();
}

export function stopDueNotifiers(): void {
  if (dueStart) clearTimeout(dueStart);
  if (dueTimer) clearInterval(dueTimer);
  dueStart = undefined;
  dueTimer = undefined;
}
