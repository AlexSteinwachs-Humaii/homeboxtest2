// Port of backend/pkgs/textutils/normalize.go. Accent-insensitive search stays
// in application code: NFD, strip nonspacing marks, NFC, then lowercase.
// Do not push this into a SQLite FTS index or a generated column.

export function removeAccents(text: string): string {
  try {
    return text.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
  } catch {
    // transform.String returns the original text when normalization fails.
    return text;
  }
}

export function normalizeSearchQuery(query: string): string {
  return removeAccents(query).toLowerCase();
}
