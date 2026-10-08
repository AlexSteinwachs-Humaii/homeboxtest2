import type { AttachmentUpload } from "../api/client";
import { photoFilename } from "./photos";

// Browser stand-in for the camera roll. The phone keeps using picker.ts.
// The bytes go to POST /api/v1/entities/{id}/attachments. Nothing is stored here.

export type PickedPhoto = AttachmentUpload & { uri?: string };

export type PickResult = { ok: true; photo: PickedPhoto } | { ok: false; cancelled: boolean; message: string };

export async function takePhoto(): Promise<PickResult> {
  return {
    ok: false,
    cancelled: false,
    message: "This browser has no camera roll. Use Attach a photo to choose a file.",
  };
}

export async function pickPhoto(): Promise<PickResult> {
  if (typeof document === "undefined") {
    return { ok: false, cancelled: false, message: "Use Attach a photo to choose a file." };
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  const file = await new Promise<File | null>((resolve) => {
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
      },
      { once: true },
    );
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  if (!file) return { ok: false, cancelled: true, message: "" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";
  return {
    ok: true,
    photo: {
      filename: photoFilename(file.name, mimeType),
      mimeType,
      bytes,
    },
  };
}
