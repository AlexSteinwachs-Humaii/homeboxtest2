import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Currency = {
  name: string;
  code: string;
  local: string;
  symbol: string;
  decimals: number;
};

const MIN_DECIMALS = 0;
const MAX_DECIMALS = 18;

function clampDecimals(decimals: number): number {
  if (!Number.isFinite(decimals) || decimals < MIN_DECIMALS) return MIN_DECIMALS;
  if (decimals > MAX_DECIMALS) return MAX_DECIMALS;
  return decimals;
}

let cached: Currency[] | null = null;

export function loadCurrencies(): Currency[] {
  if (cached) return cached;
  const candidates = [
    process.env.HBOX_CURRENCIES_PATH,
    resolve(import.meta.dir, "../../../backend/internal/core/currencies/currencies.json"),
    resolve(import.meta.dir, "../../currencies.json"),
    "/app/currencies.json",
  ].filter((path): path is string => Boolean(path));
  let parsed: Currency[] | null = null;
  for (const path of candidates) {
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as Currency[];
      break;
    } catch {
      // next layout: repo checkout, or the file copied next to the server
    }
  }
  if (!parsed) {
    cached = [];
    return cached;
  }
  const byCode = new Map<string, Currency>();
  for (const row of parsed) {
    const code = row.code.toUpperCase();
    byCode.set(code, { ...row, code, decimals: clampDecimals(row.decimals) });
  }
  cached = [...byCode.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return cached;
}

export function isSupportedCurrency(code: string): boolean {
  return loadCurrencies().some((row) => row.code === code.toUpperCase());
}
