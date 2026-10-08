import { expect, test } from "bun:test";

import { recentNotifierDeliveries, sendNotifierMessage } from "./notify.ts";

test("logger notifier test delivers instead of only validating the URL", async () => {
  const before = recentNotifierDeliveries().length;
  await sendNotifierMessage("logger://", "Test message from Homebox");
  const delivered = recentNotifierDeliveries().slice(before);
  expect(delivered.some((row) => row.message === "Test message from Homebox")).toBe(true);
  await expect(sendNotifierMessage("discord://token", "nope")).rejects.toThrow(/cannot be delivered/);
});
