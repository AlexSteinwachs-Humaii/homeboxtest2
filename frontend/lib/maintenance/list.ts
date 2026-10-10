import type { MaintenanceEntry } from "../api/types/data-contracts";
import { validDate } from "../../composables/utils";
import { toDateOnlyString } from "../datelib/dateOnly";

// The API's zero date is not a completion. Keep the same rule as the date display.
export function partitionMaintenance<T extends MaintenanceEntry>(entries: T[]) {
  return {
    scheduled: entries.filter(entry => !validDate(entry.completedDate)),
    completed: entries.filter(entry => validDate(entry.completedDate)),
  };
}

export function countOverdue(entries: MaintenanceEntry[], today = new Date()): number {
  const day = toDateOnlyString(today);
  return entries.filter(entry => {
    if (validDate(entry.completedDate) || !validDate(entry.scheduledDate)) return false;
    const scheduledDay = toDateOnlyString(entry.scheduledDate);
    return scheduledDay !== "" && scheduledDay < day;
  }).length;
}
