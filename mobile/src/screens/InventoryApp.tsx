import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { HomeboxClient, type EntityDetail, type EntitySummary, type MaintenanceEntry } from "../api/client";
import { createItem, createLocation, loadInventory, updateItem, type InventorySnapshot } from "../inventory/inventory";
import { completeMaintenance, loadMaintenance } from "../maintenance/maintenance";
import { attachPhoto, displayAttachmentId } from "../photos/photos";
import { pickPhoto, takePhoto } from "../photos/picker";
import { resolveCode, searchItems, type ScanMatch } from "../scan/lookup";
import { readPreferredCollection, writePreferredCollection } from "../session/collection";
import type { Account, StoredSession } from "../session/session";
import { resolveWebPath, type ToolId } from "../tools/catalog";
import { AccountScreen } from "./AccountScreen";
import { CollectionSwitcher, InventoryScreen } from "./InventoryScreen";
import { ItemDetail, ItemEdit, Maintenance, Search, type EditorValues, type ServerPhoto } from "./inventory-ui";
import { ScanScreen } from "./ScanScreen";
import { ToolsScreen } from "./ToolsScreen";
import { WebHome } from "./WebHome";
import { WebShell, type WebNav } from "./WebShell";

type Props = {
  account: Account;
  session: StoredSession;
  busy: boolean;
  requestedPath?: string;
  onSignOut: () => void;
  onAccountChange?: (patch: { name: string; email: string }) => void;
};

type View =
  | { name: "home" }
  | { name: "list"; tab: "items" | "locations" }
  | { name: "item"; id: string }
  | { name: "location"; id: string }
  | { name: "edit-item"; id: string | null; parentId: string | null }
  | { name: "edit-location"; parentId: string | null }
  | { name: "scan" }
  | { name: "maintenance" }
  | { name: "account" }
  | { name: "tools"; toolId: string | null; focusId?: string; missingTitle?: string; missingPath?: string };

function viewFromPath(path: string | undefined): View {
  if (!path) return Platform.OS === "web" ? { name: "home" } : { name: "list", tab: "items" };
  const route = resolveWebPath(path);
  if (route.kind === "locations") return { name: "list", tab: "locations" };
  if (route.kind === "maintenance") return { name: "maintenance" };
  if (route.kind === "hub") return { name: "tools", toolId: null };
  if (route.kind === "tool") return { name: "tools", toolId: route.id, focusId: route.focusId };
  if (route.kind === "gap") return { name: "tools", toolId: null, missingTitle: route.title, missingPath: route.path };
  return { name: "list", tab: "items" };
}

export function InventoryApp({ account, session, busy, requestedPath, onSignOut, onAccountChange }: Props) {
  const client = useMemo(() => new HomeboxClient(session.serverUrl, session.token), [session.serverUrl, session.token]);
  const [groupId, setGroupId] = useState(() => readPreferredCollection() || account.defaultGroupId);
  const generation = useRef(0);
  const photoTicket = useRef(0);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [schedulingMaintenance, setSchedulingMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [view, setView] = useState<View>(() => viewFromPath(requestedPath));
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
  client.setGroup(snapshot?.groupId ?? groupId);

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
    void reload(readPreferredCollection() || account.defaultGroupId, true);
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
    setMaintenanceMessage(null);
    setDetailLoading(true);
    client.setGroup(snapshot?.groupId ?? groupId);
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
    client.setGroup(snapshot?.groupId ?? groupId);
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

  async function uploadPicked(photo: { filename: string; mimeType: string; uri?: string; bytes?: Uint8Array }) {
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

  async function onCreateGroup(name: string) {
    setCreatingGroup(true);
    setGroupError(null);
    const result = await client.createGroup(name);
    setCreatingGroup(false);
    if (!result.ok) {
      setGroupError(result.error);
      return;
    }
    writePreferredCollection(result.data.id);
    setGroupId(result.data.id);
    setQuery("");
    searchTicket.current += 1;
    setSearchResults(null);
    setSearchError(null);
    setView({ name: "list", tab: "items" });
    void reload(result.data.id, true);
  }

  async function onScheduleMaintenance(name: string) {
    if (view.name !== "item") return;
    setSchedulingMaintenance(true);
    setMaintenanceMessage(null);
    client.setGroup(snapshot?.groupId ?? groupId);
    const result = await client.createMaintenance(view.id, name);
    setSchedulingMaintenance(false);
    if (!result.ok) {
      setMaintenanceMessage(result.error);
      return;
    }
    setMaintenanceMessage("Scheduled on the server. Open Maintenance to mark it complete.");
  }

  const refreshMaintenance = useCallback(async (activeGroup: string) => {
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
  }, [client]);

  // Resolve the selected collection before loading a directly opened route.
  // Navigation and deep links use the same load path.
  useEffect(() => {
    if (view.name === "maintenance" && snapshot?.groupId) {
      void refreshMaintenance(snapshot.groupId);
    }
  }, [view.name, snapshot?.groupId, refreshMaintenance]);

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

  function activeNav(): WebNav {
    if (view.name === "home") return "home";
    if (view.name === "list") return view.tab === "locations" ? "locations" : "items";
    if (view.name === "maintenance") return "maintenance";
    if (view.name === "account") return "profile";
    if (view.name === "tools") {
      if (view.toolId === "tags" || view.toolId === "templates") return view.toolId;
      return "tools";
    }
    if (view.name === "location" || view.name === "edit-location") return "locations";
    return "items";
  }

  function frame(node: ReactNode) {
    if (Platform.OS !== "web") return node;
    const activeGroup = snapshot?.groupId ?? groupId;
    return (
      <WebShell
        accountName={account.name || account.email}
        active={activeNav()}
        onNavigate={(nav) => {
          client.setGroup(snapshot?.groupId ?? groupId);
          if (nav === "home") setView({ name: "home" });
          else if (nav === "items") setView({ name: "list", tab: "items" });
          else if (nav === "locations") setView({ name: "list", tab: "locations" });
          else if (nav === "maintenance") {
            setMaintenanceFilter("due");
            setView({ name: "maintenance" });
          } else if (nav === "profile") setView({ name: "account" });
          else if (nav === "scan") setView({ name: "scan" });
          else if (nav === "tags" || nav === "templates") setView({ name: "tools", toolId: nav });
          else if (nav === "tools") setView({ name: "tools", toolId: null });
          else setView({ name: "list", tab: "items" });
        }}
        onCreateItem={() => {
          setSaveError(null);
          setView({ name: "edit-item", id: null, parentId: snapshot?.locations[0]?.id ?? null });
        }}
        onCreateLocation={() => {
          setSaveError(null);
          setView({ name: "edit-location", parentId: null });
        }}
        onCreateTag={() => setView({ name: "tools", toolId: "tags" })}
        onSignOut={onSignOut}
        collections={
          <CollectionSwitcher
            compact
            groups={snapshot?.groups ?? []}
            groupId={activeGroup}
            creatingGroup={creatingGroup}
            groupError={groupError}
            onCreateGroup={(name) => void onCreateGroup(name)}
            onSelectGroup={(id) => {
              writePreferredCollection(id);
              setGroupId(id);
              setGroupError(null);
              setQuery("");
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTicket.current += 1;
              setSearching(false);
              setSearchResults(null);
              setSearchError(null);
              setView({ name: "list", tab: "items" });
              setMaintenance([]);
              setMaintenanceError(null);
              maintenanceTicket.current += 1;
              void reload(id, true);
            }}
          />
        }
        search={
          <Search
            variant="header"
            query={query}
            onScan={() => setView({ name: "scan" })}
            onSubmitSearch={() => {
              if (searchTimer.current) clearTimeout(searchTimer.current);
              void runSearch(query, activeGroup);
            }}
            onQueryChange={(value) => {
              setQuery(value);
              if (value.trim() !== "") setView({ name: "list", tab: "items" });
              if (searchTimer.current) clearTimeout(searchTimer.current);
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
          />
        }
      >
        {node}
      </WebShell>
    );
  }

  if (view.name === "tools" && snapshot) {
    const activeGroup = snapshot?.groupId ?? groupId;
    return frame(
      <ToolsScreen
        client={client}
        account={account}
        items={snapshot?.items ?? []}
        locations={snapshot?.locations ?? []}
        toolId={view.toolId}
        focusId={view.focusId}
        missingTitle={view.missingTitle}
        missingPath={view.missingPath}
        busy={busy}
        onBack={() => setView({ name: "list", tab: "items" })}
        onOpenHub={() => setView({ name: "tools", toolId: null })}
        onOpenTool={(id: ToolId) => setView({ name: "tools", toolId: id })}
        onSignOut={onSignOut}
        onProfileSaved={(patch) => onAccountChange?.(patch)}
        onCollectionSaved={() => void reload(activeGroup, false)}
      />
    );
  }

  if (view.name === "account") {
    return frame(<AccountScreen account={account} busy={busy} onSignOut={onSignOut} onBack={() => setView({ name: "list", tab: "items" })} />);
  }

  if (view.name === "maintenance") {
    const activeGroup = snapshot?.groupId ?? groupId;
    const groupName = snapshot?.groups.find((group) => group.id === activeGroup)?.name ?? "Collection";
    return frame(
      <Maintenance
        groupName={groupName}
        entries={maintenance}
        filter={maintenanceFilter}
        loading={maintenanceLoading || !snapshot}
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
    return frame(
      <ScanScreen
        onBack={() => setView({ name: "list", tab: "items" })}
        onLookup={(code) => resolveCode(client, activeGroup, code)}
        onOpen={openMatch}
      />
    );
  }

  if (view.name === "edit-item" || view.name === "edit-location") {
    const editing = view.name === "edit-item" && view.id && detail?.id === view.id ? detail : null;
    return frame(
      <ItemEdit
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
    return frame(
      <ItemDetail
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
        onWebFile={view.name === "item" ? (file) => void uploadPicked(file) : undefined}
        onScheduleMaintenance={view.name === "item" ? (name) => void onScheduleMaintenance(name) : undefined}
        schedulingMaintenance={schedulingMaintenance}
        maintenanceMessage={maintenanceMessage}
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

  if (view.name === "home") {
    const activeGroup = snapshot?.groupId ?? groupId;
    return frame(
      <WebHome
        client={client}
        groupId={activeGroup}
        locations={snapshot?.locations ?? []}
        loading={loading}
        onOpenItem={(id) => void openEntity(id, "item")}
        onOpenLocation={(id) => void openEntity(id, "location")}
        onOpenTags={() => setView({ name: "tools", toolId: "tags" })}
      />,
    );
  }

  const groupName = snapshot?.groups.find((group) => group.id === (snapshot?.groupId ?? groupId))?.name ?? "Collection";
  const searchActive = query.trim() !== "" && searchResults !== null;
  const tab = view.name === "list" ? view.tab : "items";

  return frame(
    <InventoryScreen
      email={account.email}
      groupName={groupName}
      groups={snapshot?.groups ?? []}
      groupId={snapshot?.groupId ?? groupId}
      tab={tab}
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
        writePreferredCollection(id);
        setGroupId(id);
        setGroupError(null);
        setQuery("");
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTicket.current += 1;
        setSearching(false);
        setSearchResults(null);
        setSearchError(null);
        setView({ name: "list", tab });
        setMaintenance([]);
        setMaintenanceError(null);
        maintenanceTicket.current += 1;
        void reload(id, true);
      }}
      onMaintenance={() => {
        setMaintenanceFilter("due");
        setView({ name: "maintenance" });
      }}
      onTools={() => {
        client.setGroup(snapshot?.groupId ?? groupId);
        setView({ name: "tools", toolId: null });
      }}
      onSelectTab={(tab) => setView({ name: "list", tab })}
      onOpenItem={(id) => void openEntity(id, "item")}
      onOpenLocation={(id) => void openEntity(id, "location")}
      onCreateGroup={(name) => void onCreateGroup(name)}
      creatingGroup={creatingGroup}
      groupError={groupError}
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
