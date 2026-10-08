import { describe, expect, test } from "bun:test";

import { normalizeSearchQuery, removeAccents } from "./normalize.ts";

// Table copied from backend/pkgs/textutils/normalize_test.go.
const removeAccentsCases: Array<{ name: string; input: string; expected: string }> = [
  { name: "Spanish accented characters", input: "electrónica", expected: "electronica" },
  { name: "Spanish accented characters with tilde", input: "café", expected: "cafe" },
  { name: "French accented characters", input: "père", expected: "pere" },
  { name: "German umlauts", input: "Björk", expected: "Bjork" },
  { name: "Mixed accented characters", input: "résumé", expected: "resume" },
  { name: "Portuguese accented characters", input: "João", expected: "Joao" },
  { name: "No accents", input: "hello world", expected: "hello world" },
  { name: "Empty string", input: "", expected: "" },
  { name: "Numbers and symbols", input: "123!@#", expected: "123!@#" },
  { name: "Multiple accents in one word", input: "été", expected: "ete" },
  { name: "Complex Unicode characters", input: "français", expected: "francais" },
  { name: "Unicode diacritics", input: "naïve", expected: "naive" },
  { name: "Unicode combining characters", input: "e\u0301", expected: "e" },
  { name: "Very long string with accents", input: "café".repeat(1000), expected: "cafe".repeat(1000) },
  { name: "All French accents", input: "àâäéèêëïîôöùûüÿç", expected: "aaaeeeeiioouuuyc" },
  { name: "All Spanish accents", input: "áéíóúñüÁÉÍÓÚÑÜ", expected: "aeiounuAEIOUNU" },
  { name: "All German umlauts", input: "äöüÄÖÜß", expected: "aouAOUß" },
  { name: "Mixed languages", input: "Français café España niño", expected: "Francais cafe Espana nino" },
];

const normalizeQueryCases: Array<{ name: string; input: string; expected: string }> = [
  { name: "Uppercase with accents", input: "ELECTRÓNICA", expected: "electronica" },
  { name: "Mixed case with accents", input: "Electrónica", expected: "electronica" },
  { name: "Multiple words with accents", input: "Café París", expected: "cafe paris" },
  { name: "No accents mixed case", input: "Hello World", expected: "hello world" },
];

// backend/internal/data/repo/repo_items_search_test.go TestNormalizeSearchQueryIntegration
const integrationCases: Array<{ input: string; expected: string }> = [
  { input: "electrónica", expected: "electronica" },
  { input: "café", expected: "cafe" },
  { input: "ELECTRÓNICA", expected: "electronica" },
  { input: "Café París", expected: "cafe paris" },
  { input: "hello world", expected: "hello world" },
  { input: "père", expected: "pere" },
  { input: "français", expected: "francais" },
  { input: "été", expected: "ete" },
  { input: "hôtel", expected: "hotel" },
  { input: "naïve", expected: "naive" },
  { input: "PÈRE", expected: "pere" },
  { input: "FRANÇAIS", expected: "francais" },
  { input: "ÉTÉ", expected: "ete" },
  { input: "HÔTEL", expected: "hotel" },
  { input: "NAÏVE", expected: "naive" },
];

describe("removeAccents", () => {
  for (const tc of removeAccentsCases) {
    test(tc.name, () => {
      expect(removeAccents(tc.input)).toBe(tc.expected);
    });
  }
});

describe("normalizeSearchQuery", () => {
  for (const tc of normalizeQueryCases) {
    test(tc.name, () => {
      expect(normalizeSearchQuery(tc.input)).toBe(tc.expected);
    });
  }

  for (const tc of integrationCases) {
    test(tc.input, () => {
      expect(normalizeSearchQuery(tc.input)).toBe(tc.expected);
    });
  }
});
