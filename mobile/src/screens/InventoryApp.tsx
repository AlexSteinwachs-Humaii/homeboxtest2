import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HomeboxClient, type EntityDetail } from "../api/client";
import { createItem, createLocation, loadInventory, updateItem, type InventorySnapshot } from "../inventory/inventory";
import { attachPhoto, displayAttachmentId } from "../photos/photos";
import { pickPhoto, takePhoto } from "../photos/picker";
import type { Account, StoredSession } from "../session/session";
import { AccountScreen } from "./AccountScreen";
import { InventoryScreen } from "./InventoryScreen";
import { ItemDetailScreen, type ServerPhoto } from "./ItemDetailScreen";
import { ItemEditorScreen, type EditorValues } from "./ItemEditorScreen";

type Props = {
  account: Account;
  session: StoredSession;
  busy: boolean;
  onSignOut: () => void;
};

type View =
  | { name: "list"; tab: "items" | "locations" }
  | { name: "item"; id: string }
  | { name: "location"; id: string }
  | { name: "edit-item"; id: string | null; parentId: string | null }
  | { name: "edit-location"; parentId: string | null }
  | { name: "account" };

export function InventoryApp({ account, session, busy, onSignOut }: Props) {
  const client = useMemo(() => new HomeboxClient(session.serverUrl, session.token), [session.serverUrl, session.token]);
  const generation = useRef(0);
  const photoTicket = useRef(0);
  const [groupId, setGroupId] = useState(account.defaultGroupId);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [view, setView] = useState<View>({ name: "list", tab: "items" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const reload = useCallback(
    async (preferred: string, clearFirst: boolean) => {
      const ticket = ++generation.current;
      setRefreshing(true);
      setError(null);
      if (clearFirst) setSnapshot(null);
      const result = await loadInventory(client, preferred, account.defaultGroupId);
      if (ticket !== generation.current) return;
      setLoading(false);
      setRefreshing(false);
      if (!result.ok) {
        setSnapshot(null);
        setError(result.message);
        return;
      }
      setGroupId(result.data.groupId);
      setSnapshot(result.data);
    },
    [account.defaultGroupId, client],
  );

  useEffect(() => {
    void reload(account.defaultGroupId, true);
  }, [account.defaultGroupId, reload]);

  async function openEntity(id: string, kind: "item" | "location") {
    setView(kind === "item" ? { name: "item", id } : { name: "location", id });
    setDetail(null);
    setDetailError(null);
    photoTicket.current += 1;
    setPhotoError(null);
    setUploadingPhoto(false);
    setDetailLoading(true);
    client.setGroup(groupId);
    const result = await client.getEntity(id);
    setDetailLoading(false);
    if (!result.ok) {
      setDetail(null);
      setDetailError(result.error);
      return;
    }
    setDetail(result.data);
  }

  async function refreshDetail(id: string) {
    setRefreshing(true);
    setDetailError(null);
    client.setGroup(groupId);
    const result = await client.getEntity(id);
    setRefreshing(false);
    if (!result.ok) {
      setDetail(null);
      setDetailError(result.error);
      return;
    }
    setDetail(result.data);
  }

  async function saveItem(values: EditorValues, editing: EntityDetail | null) {
    if (!snapshot) {
      setSaveError("Wait for the server to finish loading this collection.");
      return;
    }
    const quantity = Number(values.quantity);
    setSaving(true);
    setSaveError(null);
    const edits = {
      name: values.name,
      description: values.description,
      quantity,
      parentId: values.parentId,
    };
    const result = editing
      ? await updateItem(client, snapshot.groupId, editing, edits)
      : await createItem(client, snapshot.groupId, { ...edits, entityTypeId: snapshot.itemTypeId ?? "" });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setDetail(result.data);
    setPhotoError(null);
    setView({ name: "item", id: result.data.id });
    void reload(snapshot.groupId, false);
  }

  async function uploadPicked(photo: { filename: string; mimeType: string; uri: string }) {
    if (view.name !== "item" || !detail || detail.id !== view.id) return;
    const ticket = ++photoTicket.current;
    const entityId = view.id;
    const previousIds = detail.attachments.map((item) => item.id);
    setUploadingPhoto(true);
    setPhotoError(null);
    const result = await attachPhoto(client, snapshot?.groupId ?? groupId, entityId, photo, previousIds);
    if (ticket !== photoTicket.current) return;
    setUploadingPhoto(false);
    if (!result.ok) {
      setPhotoError(result.message);
      return;
    }
    setDetail(result.data);
  }

  async function onTakePhoto() {
    const picked = await takePhoto();
    if (!picked.ok) {
      if (!picked.cancelled) setPhotoError(picked.message);
      return;
    }
    await uploadPicked(picked.photo);
  }

  async function onPickPhoto() {
    const picked = await pickPhoto();
    if (!picked.ok) {
      if (!picked.cancelled) setPhotoError(picked.message);
      return;
    }
    await uploadPicked(picked.photo);
  }

  async function saveLocation(values: EditorValues) {
    if (!snapshot) {
      setSaveError("Wait for the server to finish loading this collection.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await createLocation(client, snapshot.groupId, {
      name: values.name,
      parentId: values.parentId,
      entityTypeId: snapshot.locationTypeId ?? "",
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setDetail(result.data);
    setView({ name: "location", id: result.data.id });
    void reload(snapshot.groupId, false);
  }

  if (view.name === "account") {
    return <AccountScreen account={account} busy={busy} onSignOut={onSignOut} onBack={() => setView({ name: "list", tab: "items" })} />;
  }

  if (view.name === "edit-item" || view.name === "edit-location") {
    const editing = view.name === "edit-item" && view.id && detail?.id === view.id ? detail : null;
    return (
      <ItemEditorScreen
        mode={view.name === "edit-location" ? "create-location" : editing ? "edit-item" : "create-item"}
        initial={{
          name: editing?.name ?? "",
          description: editing?.description ?? "",
          quantity: editing ? String(editing.quantity) : "1",
          parentId: view.parentId,
        }}
        locations={snapshot?.locations ?? []}
        busy={saving}
        error={saveError}
        onBack={() => setView(view.name === "edit-item" && view.id ? { name: "item", id: view.id } : { name: "list", tab: view.name === "edit-location" ? "locations" : "items" })}
        onSubmit={(values) => void (view.name === "edit-location" ? saveLocation(values) : saveItem(values, editing))}
      />
    );
  }

  if (view.name === "item" || view.name === "location") {
    const filed = snapshot?.items.filter((item) => item.parentId === view.id) ?? [];
    return (
      <ItemDetailScreen
        kind={view.name}
        detail={detail?.id === view.id ? detail : null}
        filedItems={filed}
        loading={detailLoading}
        refreshing={refreshing}
        photos={view.name === "item" && detail?.id === view.id ? serverPhotos(detail, client, session.attachmentToken) : []}
        uploadingPhoto={uploadingPhoto}
        photoError={photoError}
        error={detailError}
        onBack={() => setView({ name: "list", tab: view.name === "item" ? "items" : "locations" })}
        onRefresh={() => void refreshDetail(view.id)}
        onTakePhoto={view.name === "item" ? () => void onTakePhoto() : undefined}
        onPickPhoto={view.name === "item" ? () => void onPickPhoto() : undefined}
        onEdit={view.name === "item" && detail?.id === view.id ? () => setView({ name: "edit-item", id: view.id, parentId: detail.parentId }) : undefined}
        onFileHere={
          view.name === "location"
            ? () => {
                setSaveError(null);
                setView({ name: "edit-item", id: null, parentId: view.id });
              }
            : undefined
        }
        onOpenItem={(id) => void openEntity(id, "item")}
      />
    );
  }

  const groupName = snapshot?.groups.find((group) => group.id === (snapshot?.groupId ?? groupId))?.name ?? "Collection";

  return (
    <InventoryScreen
      email={account.email}
      groupName={groupName}
      groups={snapshot?.groups ?? []}
      groupId={snapshot?.groupId ?? groupId}
      tab={view.tab}
      items={snapshot?.items ?? []}
      locations={snapshot?.locations ?? []}
      tree={snapshot?.tree ?? []}
      loading={loading}
      refreshing={refreshing}
      error={error}
      onRefresh={() => void reload(snapshot?.groupId ?? groupId, false)}
      onSelectGroup={(id) => {
        setGroupId(id);
        setView({ name: "list", tab: view.tab });
        void reload(id, true);
      }}
      onSelectTab={(tab) => setView({ name: "list", tab })}
      onOpenItem={(id) => void openEntity(id, "item")}
      onOpenLocation={(id) => void openEntity(id, "location")}
      onCreateItem={() => {
        setSaveError(null);
        setView({ name: "edit-item", id: null, parentId: snapshot?.locations[0]?.id ?? null });
      }}
      onCreateLocation={() => {
        setSaveError(null);
        setView({ name: "edit-location", parentId: null });
      }}
      onAccount={() => setView({ name: "account" })}
      onSignOut={onSignOut}
    />
  );
}

function serverPhotos(detail: EntityDetail, client: HomeboxClient, attachmentToken: string): ServerPhoto[] {
  return detail.attachments
    .filter((item) => item.type === "photo")
    .map((item) => ({
      id: item.id,
      title: item.title || "Photo",
      url: attachmentToken ? client.attachmentUrl(detail.id, displayAttachmentId(item), attachmentToken) : null,
    }));
}
