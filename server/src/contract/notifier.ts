import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Schemes from backend/internal/sys/validate/notifier_url.go. Unknown schemes
// are rejected. Identifier hosts are not network destinations.
const IDENTIFIER = new Set([
  "discord",
  "ifttt",
  "join",
  "logger",
  "notifiarr",
  "pushbullet",
  "pushover",
  "slack",
  "teams",
  "telegram",
  "twilio",
  "wecom",
]);

const HOST_FROM_URL = new Set([
  "bark",
  "googlechat",
  "gotify",
  "hangouts",
  "lark",
  "matrix",
  "mattermost",
  "mqtt",
  "mqtts",
  "ntfy",
  "opsgenie",
  "pagerduty",
  "rocketchat",
  "signal",
  "smtp",
  "zulip",
]);

const IPV4_BOGON = [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const METADATA = new BlockList();
METADATA.addSubnet("169.254.169.254", 32, "ipv4");
METADATA.addSubnet("169.254.169.253", 32, "ipv4");
METADATA.addAddress("fd00:ec2::254", "ipv6");

const BOGON = new BlockList();
for (const [address, prefix] of IPV4_BOGON) BOGON.addSubnet(address, prefix, "ipv4");
BOGON.addAddress("255.255.255.255", "ipv4");
BOGON.addAddress("::", "ipv6");
BOGON.addAddress("::1", "ipv6");
BOGON.addSubnet("100::", 64, "ipv6");
BOGON.addSubnet("2001::", 32, "ipv6");
BOGON.addSubnet("2001:10::", 28, "ipv6");
BOGON.addSubnet("2001:db8::", 32, "ipv6");
BOGON.addSubnet("fc00::", 7, "ipv6");
BOGON.addSubnet("fe80::", 10, "ipv6");
BOGON.addSubnet("ff00::", 8, "ipv6");

export type NotifierPolicy = {
  blockBogon?: boolean;
  blockMetadata?: boolean;
  blockLocalhost?: boolean;
  blockLocalNets?: boolean;
};

function splitScheme(url: string): { scheme: string; rest: string } | null {
  const at = url.indexOf("://");
  if (at <= 0) return null;
  return { scheme: url.slice(0, at).toLowerCase(), rest: url.slice(at + 3) };
}

function genericTarget(url: string): string {
  const split = splitScheme(url);
  if (!split) throw new Error("notifier URL is missing a scheme");
  const [service, transport] = split.scheme.split("+");
  if (service !== "generic") throw new Error("not a generic notifier URL");
  if (transport) {
    if (transport !== "http" && transport !== "https") throw new Error(`unsupported generic notifier transport "${transport}"`);
    return `${transport}://${split.rest}`;
  }
  if (!split.rest) throw new Error("generic notifier URL is empty");
  if (split.rest.toLowerCase().startsWith("http://") || split.rest.toLowerCase().startsWith("https://")) return split.rest;
  return `https://${split.rest}`;
}

async function addresses(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function family(ip: string): "ipv4" | "ipv6" {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}

function blocked(ip: string, policy: NotifierPolicy): string | null {
  const type = family(ip);
  if (policy.blockMetadata !== false && METADATA.check(ip, type)) return "cloud metadata endpoints are blocked";
  if (policy.blockBogon !== false && BOGON.check(ip, type)) return "bogon/reserved network addresses are blocked";
  if (policy.blockLocalhost && (ip === "127.0.0.1" || ip === "::1")) return "localhost addresses are blocked";
  if (policy.blockLocalNets) {
    const privateNets = new BlockList();
    privateNets.addSubnet("10.0.0.0", 8, "ipv4");
    privateNets.addSubnet("172.16.0.0", 12, "ipv4");
    privateNets.addSubnet("192.168.0.0", 16, "ipv4");
    privateNets.addSubnet("fc00::", 7, "ipv6");
    if (privateNets.check(ip, type)) return "private network addresses (RFC1918) are blocked";
  }
  return null;
}

async function checkHost(host: string, policy: NotifierPolicy): Promise<void> {
  if (!host) throw new Error("no hostname found in URL");
  let ips: string[];
  try {
    ips = await addresses(host);
  } catch (err) {
    throw new Error(`failed to resolve hostname: ${err instanceof Error ? err.message : err}`);
  }
  if (ips.length === 0) throw new Error("hostname did not resolve to any IP addresses");
  for (const ip of ips) {
    const reason = blocked(ip, policy);
    if (reason) throw new Error(reason);
  }
}

export async function validateNotifierUrl(url: string, policy: NotifierPolicy = {}): Promise<void> {
  const split = splitScheme(url.trim());
  if (!split) throw new Error("notifier URL is missing a scheme");
  const service = split.scheme.split("+")[0];
  if (service === "generic") {
    const target = new URL(genericTarget(url));
    await checkHost(target.hostname, policy);
    return;
  }
  if (IDENTIFIER.has(service)) return;
  if (HOST_FROM_URL.has(service)) {
    const parsed = new URL(url);
    if (!parsed.hostname) return;
    await checkHost(parsed.hostname, policy);
    return;
  }
  throw new Error(`unsupported notifier scheme "${service}"`);
}
