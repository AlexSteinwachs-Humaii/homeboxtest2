import assert from "node:assert/strict";
import test from "node:test";

import { HomeboxClient } from "../api/client";
import { attachPhoto, displayAttachmentId, photoFilename } from "./photos";

const GROUP = "11111111-1111-4111-8111-111111111111";
const ITEM = "66666666-6666-4666-8666-666666666666";
const PHOTO = "88888888-8888-4888-8888-888888888888";
const THUMB = "99999999-9999-4999-8999-999999999999";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function entity(attachments: unknown[]) {
  return {
    id: ITEM,
    name: "Lamp",
    description: "",
    quantity: 1,
    assetId: "000-001",
    notes: "",
    parent: null,
    entityType: { id: "type", name: "Item", isLocation: false },
    attachments,
  };
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init?.headers as Record<string, string> | undefined)?.[name];
}

test("photoFilename keeps the camera name, including HEIC, and does not invent a JPEG", () => {
  assert.equal(photoFilename("IMG_0001.HEIC", "image/heic"), "IMG_0001.HEIC");
  assert.equal(photoFilename("roll/photo.png", "image/png"), "photo.png");
  assert.equal(photoFilename(null, "image/heif"), "photo.heic");
  assert.equal(photoFilename("", "image/jpeg"), "photo.jpg");
});

test("a JPEG is shown from the attachment itself and a HEIC original uses the server thumbnail", () => {
  assert.equal(
    displayAttachmentId({
      id: PHOTO,
      type: "photo",
      title: "a.jpg",
      mimeType: "image/jpeg",
      path: "p",
      primary: true,
      thumbnailId: THUMB,
    }),
    PHOTO,
  );
  assert.equal(
    displayAttachmentId({
      id: PHOTO,
      type: "photo",
      title: "a.heic",
      mimeType: "image/heic",
      path: "p",
      primary: true,
      thumbnailId: THUMB,
    }),
    THUMB,
  );
});

test("upload posts multipart to the entity attachment route and the screen shows the refetch", async () => {
  const calls: Call[] = [];
  const client = new HomeboxClient("http://192.168.1.20:7745", "Bearer session", async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/attachments")) {
      return json(201, {
        id: ITEM,
        attachments: [{ id: PHOTO, type: "photo", title: "IMG_0001.HEIC", mimeType: "image/heic", path: "stored", primary: true }],
      });
    }
    return json(200, entity([{ id: PHOTO, type: "photo", title: "IMG_0001.HEIC", mimeType: "image/heic", path: "stored", primary: true, thumbnail: { id: THUMB } }]));
  });

  const result = await attachPhoto(
    client,
    GROUP,
    ITEM,
    { filename: "IMG_0001.HEIC", mimeType: "image/heic", bytes: JPEG },
    [],
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.attachments[0]?.id, PHOTO);
  assert.equal(result.data.attachments[0]?.title, "IMG_0001.HEIC");
  assert.equal(JSON.stringify(result.data).includes("file://"), false);

  const upload = calls[0];
  assert.equal(upload?.url, `http://192.168.1.20:7745/api/v1/entities/${ITEM}/attachments`);
  assert.equal(upload?.init?.method, "POST");
  assert.equal(header(upload, "Authorization"), "Bearer session");
  assert.equal(header(upload, "X-Tenant"), GROUP);
  assert.equal(header(upload, "Content-Type"), undefined);
  assert.equal(upload?.init?.credentials, "omit");
  const form = upload?.init?.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("name"), "IMG_0001.HEIC");
  assert.equal(form.get("type"), "photo");
  assert.equal(form.get("primary"), "true");
  const file = form.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "IMG_0001.HEIC");
  assert.equal(file.type, "image/heic");
  assert.equal(calls[1]?.url, `http://192.168.1.20:7745/api/v1/entities/${ITEM}`);
  assert.equal(calls[1]?.init?.method, "GET");

  client.setGroup(GROUP);
  const image = client.attachmentUrl(ITEM, PHOTO, "attach-token");
  assert.equal(image.startsWith(`http://192.168.1.20:7745/api/v1/entities/${ITEM}/attachments/${PHOTO}?`), true);
  assert.equal(image.includes("access_token=attach-token"), true);
  assert.equal(image.includes(`tenant=${GROUP}`), true);
  assert.equal(image.includes("file:"), false);
});

test("a failed upload is an error and does not present the camera file as saved", async () => {
  const calls: Call[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "session", async (url, init) => {
    calls.push({ url, init });
    return json(422, [{ field: "file", error: "file is required" }]);
  });

  const result = await attachPhoto(
    client,
    GROUP,
    ITEM,
    { filename: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG, uri: "file:///tmp/camera.jpg" },
    [],
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 422);
  assert.equal(result.message, "file is required");
  assert.equal(result.message.includes("file:///tmp/camera.jpg"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.init?.method === "GET"), false);
});

test("a 201 that the server does not return on the next read is not shown as saved", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "session", async (url) => {
    if (url.endsWith("/attachments")) return json(201, { id: ITEM, attachments: [] });
    return json(200, entity([]));
  });
  const result = await attachPhoto(client, GROUP, ITEM, { filename: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG }, []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /not saved/);
});

test("an unreachable server does not pretend the photo was saved", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "session", async () => {
    throw new Error("offline");
  });
  const result = await attachPhoto(client, GROUP, ITEM, { filename: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG }, []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 0);
  assert.match(result.message, /not saved/);
});
