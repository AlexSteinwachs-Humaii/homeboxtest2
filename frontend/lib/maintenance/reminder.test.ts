import { describe, expect, it } from "vitest";
import type { MaintenanceEntryWithDetails } from "../api/types/data-contracts";
import { nextScheduledReminder } from "./reminder";

const task = (id: string, scheduledDate: string): MaintenanceEntryWithDetails => ({
  id,
  scheduledDate,
  completedDate: "",
  itemID: `item-${id}`,
  itemName: "Air Purifier",
  name: "Replace air filter",
  description: "",
  cost: "0",
});

describe("overview maintenance reminder", () => {
  it("does not invent a task for an empty list", () => {
    expect(nextScheduledReminder([])).toBeUndefined();
  });

  it("selects only the soonest due task, including overdue tasks, without changing API order", () => {
    const later = task("later", "2026-10-10");
    const earlier = task("earlier", "2026-01-03");
    const entries = [later, earlier, task("last", "2026-11-01")];
    expect(nextScheduledReminder(entries)).toBe(earlier);
    expect(entries[0]).toBe(later);
  });

  it("ignores missing, zero, and invalid scheduled dates", () => {
    const entries = ["", "0001-01-01", "not-a-date", "2026-02-30"].map((date, i) => task(String(i), date));
    expect(nextScheduledReminder(entries)).toBeUndefined();
    const valid = task("valid", "2026-10-10");
    expect(nextScheduledReminder([...entries, valid])).toBe(valid);
  });

  it("uses stable API order for tasks due on the same day", () => {
    const first = task("first", "2026-10-10");
    expect(nextScheduledReminder([first, task("second", "2026-10-10")])).toBe(first);
  });
});
