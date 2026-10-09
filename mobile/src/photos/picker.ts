import * as ImagePicker from "expo-image-picker";

import type { AttachmentUpload } from "../api/client";
import { photoFilename } from "./photos";

// Camera and library only. The picked URI is temporary until the upload
// finishes. This module does not write an inventory database.

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 1,
  allowsEditing: false,
  exif: false,
  base64: false,
  // Keep HEIC (and any other camera original) instead of transcoding to JPEG.
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
};

export type PickedPhoto = AttachmentUpload & { uri: string };

export type PickResult = { ok: true; photo: PickedPhoto } | { ok: false; cancelled: boolean; message: string };

export async function takePhoto(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { ok: false, cancelled: false, message: "Camera access is required to photograph an item." };
  }
  return fromResult(await ImagePicker.launchCameraAsync(OPTIONS), "The camera did not return a photo.");
}

export async function pickPhoto(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { ok: false, cancelled: false, message: "Photo library access is required to pick a photo." };
  }
  return fromResult(await ImagePicker.launchImageLibraryAsync(OPTIONS), "The library did not return a photo.");
}

function fromResult(result: ImagePicker.ImagePickerResult, empty: string): PickResult {
  if (result.canceled) return { ok: false, cancelled: true, message: "" };
  const asset = result.assets[0];
  if (!asset?.uri) return { ok: false, cancelled: false, message: empty };
  const mimeType = asset.mimeType || mimeFromName(asset.fileName) || "image/jpeg";
  return {
    ok: true,
    photo: {
      uri: asset.uri,
      filename: photoFilename(asset.fileName, mimeType),
      mimeType,
    },
  };
}

function mimeFromName(fileName: string | null | undefined): string {
  const lower = (fileName ?? "").toLowerCase();
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "";
}
