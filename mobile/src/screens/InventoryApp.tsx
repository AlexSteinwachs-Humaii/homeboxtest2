import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HomeboxClient, type EntityDetail, type EntitySummary, type MaintenanceEntry } from "../api/client";
import { createItem, createLocation, loadInventory, updateItem, type InventorySnapshot } from "../inventory/inventory";
import { completeMaintenance, loadMaintenance } from "../maintenance/maintenance";
import { attachPhoto, displayAttachmentId } from "../photos/photos";
import { pickPhoto, takePhoto } from "../photos/picker";
import { resolveCode, searchItems, type ScanMatch } from "../scan/lookup";
import type { Account, StoredSession } from "../session/session";
import { AccountScreen } from "./AccountScreen";
import { InventoryScreen } from "./InventoryScreen";
import { ItemDetailScreen, type ServerPhoto } from "./ItemDetailScreen";
import { ItemEditorScreen, type EditorValues } from "./ItemEditorScreen";
import { MaintenanceScreen } from "./MaintenanceScreen";
import { ScanScreen } from "./ScanScreen";

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
  | { name: "scan" }
  | { name: "maintenance" }
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
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<EntitySummary[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTicket = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maintenanceTicket = useRef(0);
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>([]);
  const [maintenanceFilter, setMaintenanceFilter] = useState<"due" | "done" | "all">("due");
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

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

  async function runSearch(text: string, activeGroup: string) {
    const ticket = ++searchTicket.current;
    if (text.trim() === "") {
      setSearching(false);
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    const result = await searchItems(client, activeGroup, text);
    if (ticket !== searchTicket.current) return;
    setSearching(false);
    if (!result.ok) {
      setSearchResults([]);
      setSearchError(result.message);
      return;
    }
    setSearchResults(result.items);
  }

  function openMatch(match: ScanMatch) {
    void openEntity(match.id, match.kind === "location" ? "location" : "item");
  }

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

  async function refreshMaintenance(activeGroup: string) {
    const ticket = ++maintenanceTicket.current;
    setMaintenanceLoading(true);
    setRefreshing(true);
    setMaintenanceError(null);
    setMaintenance([]);
    const result = await loadMaintenance(client, activeGroup);
    if (ticket !== maintenanceTicket.current) return;
    setMaintenanceLoading(false);
    setRefreshing(false);
    if (!result.ok) {
      setMaintenance([]);
      setMaintenanceError(result.message);
      return;
    }
    setMaintenance(result.data);
  }

  async function onCompleteMaintenance(entry: MaintenanceEntry) {
    const activeGroup = snapshot?.groupId ?? groupId;
    const ticket = ++maintenanceTicket.current;
    setCompletingId(entry.id);
    setMaintenanceError(null);
    const result = await completeMaintenance(client, activeGroup, entry);
    if (ticket !== maintenanceTicket.current) return;
    setCompletingId(null);
    setMaintenanceLoading(false);
    setRefreshing(false);
    if (!result.ok) {
      setMaintenanceError(result.message);
      return;
    }
    setMaintenanceFilter("all");
    setMaintenance(result.data);
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

  if (view.name === "maintenance") {
    const activeGroup = snapshot?.groupId ?? groupId;
    const groupName = snapshot?.groups.find((group) => group.id === activeGroup)?.name ?? "Collection";
    return (
      <MaintenanceScreen
        groupName={groupName}
        entries={maintenance}
        filter={maintenanceFilter}
        loading={maintenanceLoading}
        refreshing={refreshing}
        completingId={completingId}
        error={maintenanceError}
        onFilter={setMaintenanceFilter}
        onRefresh={() => void refreshMaintenance(activeGroup)}
        onComplete={(entry) => void onCompleteMaintenance(entry)}
        onOpenItem={(id) => void openEntity(id, "item")}
        onBack={() => {
          maintenanceTicket.current += 1;
          setMaintenance([]);
          setMaintenanceError(null);
          setCompletingId(null);
          setMaintenanceLoading(false);
          setRefreshing(false);
          setView({ name: "list", tab: "items" });
        }}
      />
    );
  }

  if (view.name === "scan") {
    const activeGroup = snapshot?.groupId ?? groupId;
    return (
      <ScanScreen
        onBack={() => setView({ name: "list", tab: "items" })}
        onLookup={(code) => resolveCode(client, activeGroup, code)}
        onOpen={openMatch}
      />
    );
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
  const searchActive = query.trim() !== "" && searchResults !== null;

  return (
    <InventoryScreen
      email={account.email}
      groupName={groupName}
      groups={snapshot?.groups ?? []}
      groupId={snapshot?.groupId ?? groupId}
      tab={view.tab}
      items={searchActive ? (searchResults ?? []) : (snapshot?.items ?? [])}
      locations={snapshot?.locations ?? []}
      tree={snapshot?.tree ?? []}
      loading={loading}
      refreshing={refreshing}
      error={searchActive ? searchError : error}
      query={query}
      searchActive={searchActive}
      searching={searching}
      onQueryChange={(value) => {
        setQuery(value);
        if (searchTimer.current) clearTimeout(searchTimer.current);
        const activeGroup = snapshot?.groupId ?? groupId;
        if (value.trim() === "") {
          searchTicket.current += 1;
          setSearching(false);
          setSearchResults(null);
          setSearchError(null);
          return;
        }
        searchTimer.current = setTimeout(() => {
          void runSearch(value, activeGroup);
        }, 300);
      }}
      onSubmitSearch={() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        void runSearch(query, snapshot?.groupId ?? groupId);
      }}
      onScan={() => setView({ name: "scan" })}
      onRefresh={() => {
        const activeGroup = snapshot?.groupId ?? groupId;
        if (query.trim() !== "") void runSearch(query, activeGroup);
        else void reload(activeGroup, false);
      }}
      onSelectGroup={(id) => {
        setGroupId(id);
        setQuery("");
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTicket.current += 1;
        setSearching(false);
        setSearchResults(null);
        setSearchError(null);
        setView({ name: "list", tab: view.tab });
        setMaintenance([]);
        setMaintenanceError(null);
        maintenanceTicket.current += 1;
        void reload(id, true);
      }}
      onMaintenance={() => {
        setMaintenanceFilter("due");
        setView({ name: "maintenance" });
        void refreshMaintenance(snapshot?.groupId ?? groupId);
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
