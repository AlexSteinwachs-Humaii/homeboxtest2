import { describe, expect, it } from "vitest";
import type { MaintenanceEntry } from "../api/types/data-contracts";
import { countOverdue, partitionMaintenance } from "./list";

const entry = (id: string, scheduledDate = "", completedDate = "") =>
  ({ id, scheduledDate, completedDate }) as unknown as MaintenanceEntry;

describe("maintenance list", () => {
  it("keeps completed history separate from scheduled entries, including API zero dates", () => {
    const rows = [
      entry("done", "2026-10-01", "2026-10-02"),
      entry("zero", "2026-10-10", "0001-01-01T00:00:00Z"),
      entry("unset"),
      entry("invalid", "", "invalid"),
    ];
    const { scheduled, completed } = partitionMaintenance(rows);
    expect(scheduled.map(row => row.id)).toEqual(["zero", "unset", "invalid"]);
    expect(completed.map(row => row.id)).toEqual(["done"]);
  });

  it("counts only scheduled dates before the local calendar day, not today or completed work", () => {
    const rows = [
      entry("yesterday", "2026-10-06"),
      entry("today", "2026-10-07"),
      entry("tomorrow", "2026-10-08"),
      entry("done", "2026-10-01", "2026-10-02"),
      entry("zero", "0001-01-01T00:00:00Z"),
      entry("unset"),
      entry("invalid", "invalid"),
    ];
    expect(countOverdue(rows, new Date(2026, 9, 7, 23, 59))).toBe(1);
    expect(countOverdue(rows.slice(1), new Date(2026, 9, 7))).toBe(0);
    expect(countOverdue([], new Date(2026, 9, 7))).toBe(0);
  });
});
