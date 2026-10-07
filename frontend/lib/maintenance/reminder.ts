import type { MaintenanceEntryWithDetails } from "../api/types/data-contracts";
import { parseDateOnly, toDateOnlyString } from "../datelib/dateOnly";

// Keep API order untouched. Date-only keys sort by calendar day without UTC shifts.
// Entries without a real due date cannot provide an actionable reminder.
export function nextScheduledReminder(entries: MaintenanceEntryWithDetails[]): MaintenanceEntryWithDetails | undefined {
  return entries
    .map(entry => ({ entry, date: toDateOnlyString(entry.scheduledDate) }))
    .filter(({ date }) => parseDateOnly(date) !== null && !date.startsWith("0001-"))
    .sort((a, b) => a.date.localeCompare(b.date))[0]?.entry;
}
