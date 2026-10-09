// Maintenance for the signed-in collection. The server owns the log. This module
// does not write a file, a database, or a module-level copy of the entries.

import type { HomeboxClient, MaintenanceEntry, MaintenanceStatus, MaintenanceUpdate } from "../api/client";

export type MaintenanceResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export function localDateOnly(now = new Date()): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isComplete(entry: { completedDate: string }): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(entry.completedDate) && !entry.completedDate.startsWith("0001-");
}

// The website marks an entry done by setting completedDate and sending the
// rest of the row unchanged. Cost stays a string because the Go field is cost,string.
export function completionUpdate(entry: MaintenanceEntry, completedDate: string): MaintenanceUpdate {
  return {
    name: entry.name,
    description: entry.description,
    cost: entry.cost,
    completedDate,
    scheduledDate: entry.scheduledDate,
  };
}

export function sortMaintenance(entries: MaintenanceEntry[]): MaintenanceEntry[] {
  return [...entries].sort((left, right) => {
    const leftDone = isComplete(left) ? 1 : 0;
    const rightDone = isComplete(right) ? 1 : 0;
    if (leftDone !== rightDone) return leftDone - rightDone;
    const leftWhen = left.scheduledDate || left.completedDate;
    const rightWhen = right.scheduledDate || right.completedDate;
    if (leftWhen !== rightWhen) return leftWhen < rightWhen ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export async function loadMaintenance(
  client: HomeboxClient,
  groupId: string,
  status: MaintenanceStatus = "both",
): Promise<MaintenanceResult<MaintenanceEntry[]>> {
  client.setGroup(groupId);
  const result = await client.listMaintenance(status);
  if (!result.ok) return { ok: false, status: result.status, message: result.error };
  return { ok: true, data: result.data };
}

// Success is the list the server returns after the update, not the form we sent.
export async function completeMaintenance(
  client: HomeboxClient,
  groupId: string,
  entry: MaintenanceEntry,
  completedDate = localDateOnly(),
): Promise<MaintenanceResult<MaintenanceEntry[]>> {
  client.setGroup(groupId);
  const updated = await client.updateMaintenance(entry.id, completionUpdate(entry, completedDate));
  if (!updated.ok) {
    return { ok: false, status: updated.status, message: updated.error };
  }
  const listed = await client.listMaintenance("both");
  if (!listed.ok) {
    return {
      ok: false,
      status: listed.status,
      message: "The server accepted the update, but the list could not be refreshed. Refresh before treating it as complete.",
    };
  }
  const fresh = listed.data.find((row) => row.id === entry.id);
  if (!fresh || !isComplete(fresh)) {
    return { ok: false, status: listed.status, message: "The server did not show this entry as complete." };
  }
  return { ok: true, data: listed.data };
}
