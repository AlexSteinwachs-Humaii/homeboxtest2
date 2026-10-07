import { afterEach, expect, test, vi } from "vitest";
import { useInventoryExport } from "./use-inventory-export";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function browser() {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();
  vi.stubGlobal("document", {
    createElement: vi.fn(() => link),
    body: { appendChild },
  });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { link, appendChild, create, revoke };
}

test("prevents duplicate preparation and cleans download resources, including empty inventory", async () => {
  vi.useFakeTimers();
  const { link, appendChild, create, revoke } = browser();
  let resolve!: (blob: Blob) => void;
  const request = vi.fn(
    () =>
      new Promise<Blob>(r => {
        resolve = r;
      })
  );
  const onError = vi.fn();
  const { exporting, download } = useInventoryExport(request, onError);
  const pending = download();
  expect(exporting.value).toBe(true);
  await download();
  expect(request).toHaveBeenCalledOnce();
  const blob = new Blob(["HB.name\n"], { type: "text/csv" });
  resolve(blob);
  await pending;
  expect(exporting.value).toBe(false);
  expect(create).toHaveBeenCalledWith(blob);
  expect(link.download).toBe("homebox-dashboard-inventory.csv");
  expect(appendChild).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledOnce();
  expect(link.remove).toHaveBeenCalledOnce();
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith("blob:test");
  expect(onError).not.toHaveBeenCalled();
});

test("failure never creates a download and restores retry", async () => {
  vi.useFakeTimers();
  const { create, link } = browser();
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Blob(["HB.name\n"]));
  const onError = vi.fn();
  const { exporting, download } = useInventoryExport(request, onError);
  await download();
  expect(onError).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(exporting.value).toBe(false);
  await download();
  expect(link.click).toHaveBeenCalledOnce();
  expect(exporting.value).toBe(false);
  vi.runAllTimers();
});
