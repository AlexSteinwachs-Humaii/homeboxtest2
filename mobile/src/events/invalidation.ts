// The website listens on the same invalidation channel the server already
// publishes. A browser cannot set Authorization, so the session token rides
// the hb-auth subprotocol the server accepts.

const REFRESH_EVENTS = new Set(["entity.mutation", "tag.mutation", "import.mutation", "export.mutation"]);

export function invalidationSocketUrl(serverUrl: string, groupId: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/ws/events";
  url.search = "";
  url.searchParams.set("tenant", groupId);
  return url.toString();
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
      next = new WebSocket(invalidationSocketUrl(serverUrl, groupId), ["hb-auth", token]);
    } catch {
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
