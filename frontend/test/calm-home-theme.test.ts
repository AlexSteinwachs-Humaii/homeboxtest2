import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { themes } from "../lib/data/themes";

const css = readFileSync(new URL("../assets/css/main.css", import.meta.url), "utf8");
const bootScript = readFileSync(new URL("../public/set-theme.js", import.meta.url), "utf8");

function tokens(selector: string) {
  const block = css.slice(css.indexOf(selector)).match(/\{([^}]+)\}/)![1]!;
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
}

describe("Calm Home default theme", () => {
  it("uses the existing surface and action tokens with a modest radius", () => {
    const theme = tokens(":root,.homebox");
    expect(theme).toMatchObject({
      background: "40 23% 97%",
      foreground: "150 5% 16%",
      card: "0 0% 100%",
      popover: "0 0% 100%",
      primary: "158 46% 27%",
      "primary-foreground": "0 0% 100%",
      secondary: "40 18% 93%",
      "sidebar-background": "40 18% 93%",
      border: "40 15% 87%",
      radius: "0.5rem",
    });
    expect(theme.ring).toBe(theme.primary);
    expect(theme["sidebar-primary"]).toBe(theme.primary);
    expect(theme["card-foreground"]).toBe(theme.foreground);
    expect(theme["popover-foreground"]).toBe(theme.foreground);
  });

  it("keeps every stylesheet theme in the selectable options", () => {
    const selectors = [...css.matchAll(/\.theme-([\w-]+)\s*\{/g)].map(match => match[1]);
    expect(selectors).toHaveLength(28);
    for (const name of selectors) {
      expect(themes.map(theme => theme.value)).toContain(name);
    }
    expect(tokens(".theme-night")).toMatchObject({
      background: "222 47% 11%",
      primary: "198 93% 60%",
    });
  });

  it.each(themes.filter(theme => theme.value !== "homebox"))(
    "restores saved $value on startup without rewriting preferences",
    ({ value }) => {
      const saved = JSON.stringify({ theme: value });
      const localStorage = {
        getItem: vi.fn(() => saved),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const setAttribute = vi.fn();
      const add = vi.fn();
      runInNewContext(bootScript, {
        localStorage,
        document: { documentElement: { setAttribute, classList: { add } } },
        console: { log: vi.fn(), error: vi.fn() },
      });
      expect(setAttribute).toHaveBeenCalledWith("data-theme", value);
      expect(add).toHaveBeenCalledWith(`theme-${value}`);
      expect(localStorage.getItem).toHaveBeenCalledWith("homebox/preferences/location");
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    }
  );
});
