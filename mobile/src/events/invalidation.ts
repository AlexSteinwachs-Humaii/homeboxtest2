// The website listens on the same invalidation channel the server already
// publishes. A browser cannot set Authorization, so the session token rides
// the hb-auth subprotocol the server accepts. The stored token is often
// "Bearer <raw>"; a subprotocol cannot contain a space, and Chromium rejects
// the constructor before any request is sent.

const REFRESH_EVENTS = new Set(["entity.mutation", "tag.mutation", "import.mutation", "export.mutation"]);

// RFC 6455 token: no spaces, commas, or other separators.
const SUBPROTOCOL_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function invalidationSocketUrl(serverUrl: string, groupId: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/ws/events";
  url.search = "";
  url.searchParams.set("tenant", groupId);
  return url.toString();
}

export function websocketProtocols(token: string): string[] | undefined {
  const raw = token.trim().replace(/^bearer\s+/i, "");
  if (!raw || !SUBPROTOCOL_TOKEN.test(raw)) return undefined;
  return ["hb-auth", raw];
}

export function subscribeInvalidation(
  serverUrl: string,
  token: string,
  groupId: string,
  onChange: (event: string) => void,
): () => void {
  if (typeof WebSocket === "undefined" || !token || !groupId) return () => {};
  let stopped = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (stopped) return;
    let next: WebSocket;
    try {
      const protocols = websocketProtocols(token);
      next = protocols
        ? new WebSocket(invalidationSocketUrl(serverUrl, groupId), protocols)
        : new WebSocket(invalidationSocketUrl(serverUrl, groupId));
    } catch {
      attempt += 1;
      if (!stopped && attempt <= 8) timer = setTimeout(open, 1500);
      return;
    }
    socket = next;
    next.onopen = () => {
      attempt = 0;
    };
    next.onmessage = (ev) => {
      let event = "";
      try {
        event = String((JSON.parse(String(ev.data)) as { event?: string }).event ?? "");
      } catch {
        return;
      }
      if (!REFRESH_EVENTS.has(event)) return;
      onChange(event);
    };
    next.onclose = () => {
      if (stopped || socket !== next) return;
      attempt += 1;
      if (attempt > 8) return;
      timer = setTimeout(open, 1500);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
