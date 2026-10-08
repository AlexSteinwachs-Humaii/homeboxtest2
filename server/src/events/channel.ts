import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";

import { authorize, jsonError } from "../auth/guard.ts";
import { BUS_EVENTS, WIRE_EVENT, bus, type BusEvent } from "./bus.ts";

export type EventSocketData = { groupId: string };

type Client = {
  data: EventSocketData;
  send(data: string): void;
};

const clients = new Set<Client>();
let subscribed = false;
let ping: ReturnType<typeof setInterval> | undefined;

function payload(event: BusEvent): string {
  return JSON.stringify({ event: WIRE_EVENT[event] });
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  for (const event of BUS_EVENTS) {
    const body = payload(event);
    bus.subscribe(event, (groupId) => {
      for (const client of clients) {
        if (client.data.groupId !== groupId) continue;
        try {
          client.send(body);
        } catch {
          clients.delete(client);
        }
      }
    });
  }
}

export function addEventClient(client: Client): void {
  ensureSubscribed();
  clients.add(client);
}

export function removeEventClient(client: Client): void {
  clients.delete(client);
}

// Go broadcasts {"event":"ping"} every 10s so idle sockets stay up. unref so tests can exit.
export function startEventChannel(): void {
  ensureSubscribed();
  if (ping) return;
  ping = setInterval(() => {
    const body = JSON.stringify({ event: "ping" });
    for (const client of clients) {
      try {
        client.send(body);
      } catch {
        clients.delete(client);
      }
    }
  }, 10_000);
  ping.unref?.();
}

export function stopEventChannel(): void {
  if (ping) clearInterval(ping);
  ping = undefined;
}

export const eventWebSocket = {
  open(ws: ServerWebSocket<EventSocketData>) {
    addEventClient(ws);
  },
  close(ws: ServerWebSocket<EventSocketData>) {
    removeEventClient(ws);
  },
  message() {},
};

type UpgradeServer = {
  upgrade(request: Request, options?: { data?: EventSocketData; headers?: HeadersInit }): boolean;
};

// Authenticated upgrade is handled here so an unauthenticated handshake never becomes a socket.
// A non-upgrade GET falls through to the Hono route, which applies the same auth check.
export function handleEventsUpgrade(
  request: Request,
  server: UpgradeServer,
  db: Database,
): Response | "upgraded" | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/ws/events" || request.method !== "GET") return undefined;
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined;

  const actor = authorize(request, db);
  if (actor instanceof Response) return actor;

  const headers: Record<string, string> = {};
  const offered = request.headers.get("sec-websocket-protocol") ?? "";
  if (offered.split(",").some((part) => part.trim() === "hb-auth")) {
    headers["Sec-WebSocket-Protocol"] = "hb-auth";
  }
  startEventChannel();
  const ok = server.upgrade(request, { data: { groupId: actor.groupId }, headers });
  if (!ok) return jsonError(400, "websocket upgrade failed");
  return "upgraded";
}

export function eventsHttpResponse(request: Request, db: Database): Response {
  if (request.method !== "GET") return jsonError(404, "not found");
  const actor = authorize(request, db);
  if (actor instanceof Response) return actor;
  return jsonError(400, "websocket upgrade required");
}
