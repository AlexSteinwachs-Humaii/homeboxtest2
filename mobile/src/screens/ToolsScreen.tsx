import { createElement, useEffect, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { HomeboxClient } from "../api/client";
import type { Account } from "../session/session";
import { colors } from "../theme";
import { notInThisRelease, PROFILE_GAPS, TOOLS, toolById, type ToolId } from "../tools/catalog";
import { bytesToDataUrl, triggerDownload } from "../tools/files";

type Named = { id: string; name: string };

type Props = {
  client: HomeboxClient;
  account: Account;
  items: Named[];
  locations: Named[];
  toolId: string | null;
  focusId?: string;
  missingTitle?: string;
  missingPath?: string;
  busy: boolean;
  onBack: () => void;
  onOpenHub: () => void;
  onOpenTool: (id: ToolId) => void;
  onSignOut: () => void;
  onProfileSaved: (patch: { name: string; email: string }) => void;
  onCollectionSaved: () => void;
};

export function ToolsScreen(props: Props) {
  const tool = props.toolId ? toolById(props.toolId) : undefined;
  const title = props.missingTitle ? props.missingTitle : tool?.title ?? "Tools";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={tool || props.missingTitle ? props.onOpenHub : props.onBack} style={styles.back}>
          <Text style={styles.backText}>{tool || props.missingTitle ? "All tools" : "Inventory"}</Text>
        </Pressable>
        <Text style={styles.kicker}>Tools</Text>
        <Text style={styles.title}>{title}</Text>
        {props.missingTitle ? (
          <GapNotice title={props.missingTitle} path={props.missingPath} />
        ) : !tool ? (
          <Hub onOpenTool={props.onOpenTool} />
        ) : !tool.implemented ? (
          <GapNotice title={tool.title} />
        ) : (
          <ToolPanel {...props} toolId={tool.id} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Hub({ onOpenTool }: { onOpenTool: (id: ToolId) => void }) {
  return (
    <View>
      <Text style={styles.note}>
        These are the labels, import/export, and settings tools from the previous website. Each one opens here. A tool that is not built says so by name.
      </Text>
      {TOOLS.map((tool) => (
        <Pressable
          key={tool.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${tool.title}`}
          onPress={() => onOpenTool(tool.id)}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>{tool.title}</Text>
          <Text style={styles.cardBody}>{tool.implemented ? tool.summary : notInThisRelease(tool.title)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function GapNotice({ title, path }: { title: string; path?: string }) {
  return (
    <View accessibilityRole="text">
      <Text style={styles.notice}>{notInThisRelease(title)}</Text>
      <Text style={styles.note}>
        {path ? `${path} is still listed so it is not a blank page. ` : ""}
        Open All tools to reach Labels, QR, CSV import/export, collection import/export, profile, collection settings, members, invites, notifiers, entity types, and templates.
      </Text>
    </View>
  );
}

function ToolPanel(props: Props & { toolId: ToolId }) {
  switch (props.toolId) {
    case "labels":
      return <LabelsPanel client={props.client} items={props.items} locations={props.locations} focusId={props.focusId} />;
    case "qr":
      return <QrPanel client={props.client} />;
    case "csv":
      return <CsvPanel client={props.client} onOpenTool={props.onOpenTool} />;
    case "collection-transfer":
      return <TransferPanel client={props.client} onImported={props.onCollectionSaved} />;
    case "bill-of-materials":
      return <DownloadPanel client={props.client} label="Download bill of materials" load={() => props.client.billOfMaterials()} />;
    case "maintenance-actions":
      return <ActionsPanel client={props.client} onDone={props.onCollectionSaved} />;
    case "profile":
      return <ProfilePanel client={props.client} account={props.account} busy={props.busy} onSaved={props.onProfileSaved} onSignOut={props.onSignOut} />;
    case "collection-settings":
      return <SettingsPanel client={props.client} onSaved={props.onCollectionSaved} />;
    case "members":
      return <MembersPanel client={props.client} selfId={props.account.id} />;
    case "invites":
      return <InvitesPanel client={props.client} />;
    case "notifiers":
      return <NotifiersPanel client={props.client} />;
    case "entity-types":
      return <TypesPanel client={props.client} />;
    case "templates":
      return <TemplatesPanel client={props.client} focusId={props.focusId} />;
    case "tags":
      return <TagsPanel client={props.client} focusId={props.focusId} />;
    default:
      return <GapNotice title="This page" />;
  }
}

function LabelsPanel({
  client,
  items,
  locations,
  focusId,
}: {
  client: HomeboxClient;
  items: Named[];
  locations: Named[];
  focusId?: string;
}) {
  const [assetId, setAssetId] = useState(focusId ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make(kind: "entity" | "location" | "asset", id: string, label: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const result = await client.labelImage(kind, id);
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      setError(result.error);
      return;
    }
    setPreview(bytesToDataUrl(result.data.bytes, result.data.contentType || "image/png"));
    setStatus(`Label for ${label} came from the server.`);
  }

  return (
    <View>
      <Text style={styles.note}>Labels are images from the server. Nothing is drawn from a local database.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.note}>{status}</Text> : null}
      {preview ? <Image source={{ uri: preview }} style={styles.preview} accessibilityLabel="Label preview" /> : null}
      <Text style={styles.section}>Items</Text>
      {items.length === 0 ? <Text style={styles.note}>No items in this collection yet.</Text> : null}
      {items.map((item) => (
        <RowButton key={item.id} label={`Make label for ${item.name}`} disabled={busy} onPress={() => void make("entity", item.id, item.name)} />
      ))}
      <Text style={styles.section}>Locations</Text>
      {locations.map((location) => (
        <RowButton
          key={location.id}
          label={`Make location label for ${location.name}`}
          disabled={busy}
          onPress={() => void make("location", location.id, location.name)}
        />
      ))}
      <Text style={styles.section}>Asset id</Text>
      <TextInput
        value={assetId}
        onChangeText={setAssetId}
        placeholder="000-001"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Asset id"
        style={styles.input}
      />
      <RowButton label="Make asset label" disabled={busy || assetId.trim() === ""} onPress={() => void make("asset", assetId.trim(), assetId.trim())} />
    </View>
  );
}

function QrPanel({ client }: { client: HomeboxClient }) {
  const [data, setData] = useState("https://example.com/item");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    setError(null);
    const result = await client.qrImage(data.trim());
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      setError(result.error);
      return;
    }
    setPreview(bytesToDataUrl(result.data.bytes, result.data.contentType || "image/jpeg"));
  }

  return (
    <View>
      <Text style={styles.note}>The QR image comes from the server QR route. It is not an Expo API route.</Text>
      <TextInput
        value={data}
        onChangeText={setData}
        accessibilityLabel="QR data"
        placeholder="Text or address"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <RowButton label={busy ? "Making QR…" : "Make QR code"} disabled={busy || data.trim() === ""} onPress={() => void make()} />
      {preview ? <Image source={{ uri: preview }} style={styles.preview} accessibilityLabel="QR code" /> : null}
    </View>
  );
}

function CsvPanel({ client, onOpenTool }: { client: HomeboxClient; onOpenTool: (id: ToolId) => void }) {
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setError(null);
    const result = await client.exportEntitiesCsv();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = triggerDownload(result.data.filename, result.data.contentType, result.data.bytes);
    setCsv(new TextDecoder().decode(result.data.bytes));
    setMessage(saved ? "CSV downloaded from the server." : "CSV loaded from the server. Copy it from the box below.");
  }

  async function upload(filename: string, bytes: Uint8Array) {
    setBusy(true);
    setError(null);
    const result = await client.importEntitiesCsv(filename, bytes);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("CSV imported on the server.");
  }

  return (
    <View>
      <Text style={styles.note}>Import and export use the collection CSV routes. The file is not stored in the browser.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <RowButton label={busy ? "Working…" : "Export CSV"} disabled={busy} onPress={() => void download()} />
      <WebFilePicker
        label="Import CSV file"
        accept=".csv,text/csv"
        disabled={busy}
        onFile={(file) => void upload(file.filename, file.bytes)}
      />
      <TextInput
        value={csv}
        onChangeText={setCsv}
        multiline
        accessibilityLabel="CSV text"
        placeholder="Or paste CSV here"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.area]}
      />
      <RowButton
        label="Import pasted CSV"
        disabled={busy || csv.trim() === ""}
        onPress={() => void upload("import.csv", new TextEncoder().encode(csv))}
      />
      <Text style={styles.section}>Also on the previous tools page</Text>
      <RowButton label="Open Labels" onPress={() => onOpenTool("labels")} />
      <RowButton label="Open QR" onPress={() => onOpenTool("qr")} />
      <RowButton label="Open Collection import/export" onPress={() => onOpenTool("collection-transfer")} />
      <RowButton label="Open Bill of materials" onPress={() => onOpenTool("bill-of-materials")} />
      <RowButton label="Open Maintenance actions" onPress={() => onOpenTool("maintenance-actions")} />
    </View>
  );
}

function TransferPanel({ client, onImported }: { client: HomeboxClient; onImported: () => void }) {
  const [rows, setRows] = useState<Array<{ id: string; status: string; sizeBytes: number }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listCollectionExports();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await client.startCollectionExport();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Collection export created on the server.");
    await load();
  }

  async function download(id: string) {
    setBusy(true);
    setError(null);
    const result = await client.downloadCollectionExport(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = triggerDownload(result.data.filename, result.data.contentType, result.data.bytes);
    setMessage(saved ? "Export downloaded from the server." : "Export is ready, but this device cannot start a download.");
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await client.deleteCollectionExport(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  async function restore(filename: string, bytes: Uint8Array) {
    setBusy(true);
    setError(null);
    const result = await client.importCollectionZip(filename, bytes);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Collection import finished on the server.");
    onImported();
    await load();
  }

  return (
    <View>
      <Text style={styles.note}>Exports and imports use the collection zip routes. A restore replaces this collection on the server.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <RowButton label={busy ? "Working…" : "Create collection export"} disabled={busy} onPress={() => void create()} />
      {rows.length === 0 ? <Text style={styles.note}>No exports yet.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.status}</Text>
          <Text style={styles.cardBody}>{row.sizeBytes} bytes</Text>
          <RowButton label={`Download export ${row.id}`} disabled={busy} onPress={() => void download(row.id)} />
          <RowButton label={`Delete export ${row.id}`} disabled={busy} onPress={() => void remove(row.id)} />
        </View>
      ))}
      <WebFilePicker label="Import collection zip" accept=".zip,application/zip" disabled={busy} onFile={(file) => void restore(file.filename, file.bytes)} />
    </View>
  );
}

function DownloadPanel({
  client,
  label,
  load,
}: {
  client: HomeboxClient;
  label: string;
  load: () => Promise<{ ok: true; data: { bytes: Uint8Array; contentType: string; filename: string } } | { ok: false; error: string }>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await load();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = triggerDownload(result.data.filename, result.data.contentType, result.data.bytes);
    setMessage(saved ? "Downloaded from the server." : "The report loaded, but this device cannot start a download.");
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <RowButton label={busy ? "Working…" : label} disabled={busy} onPress={() => void run()} />
    </View>
  );
}

const ACTIONS: Array<{ label: string; path: string; body?: Record<string, unknown>; confirm?: boolean }> = [
  { label: "Ensure asset IDs", path: "/api/v1/actions/ensure-asset-ids" },
  { label: "Ensure import refs", path: "/api/v1/actions/ensure-import-refs" },
  { label: "Zero item datetimes", path: "/api/v1/actions/zero-item-time-fields" },
  { label: "Set primary photos", path: "/api/v1/actions/set-primary-photos" },
  { label: "Create missing thumbnails", path: "/api/v1/actions/create-missing-thumbnails" },
  { label: "Wipe inventory", path: "/api/v1/actions/wipe-inventory", body: { wipeTags: false, wipeLocations: false, wipeMaintenance: false }, confirm: true },
];

function ActionsPanel({ client, onDone }: { client: HomeboxClient; onDone: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: (typeof ACTIONS)[number]) {
    if (action.confirm && confirm.trim() !== "WIPE") {
      setError("Type WIPE before wiping inventory.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await client.runMaintenanceAction(action.path, action.body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`${action.label} finished on the server (${result.data.completed}).`);
    onDone();
  }

  return (
    <View>
      <Text style={styles.note}>These are the collection actions from the previous tools page. Each one calls the existing server route.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      {ACTIONS.filter((action) => !action.confirm).map((action) => (
        <RowButton key={action.path} label={action.label} disabled={busy} onPress={() => void run(action)} />
      ))}
      <Text style={styles.section}>Wipe inventory</Text>
      <Text style={styles.note}>Removes items in this collection. Type WIPE to enable it. Tags, locations, and maintenance stay unless you change that later.</Text>
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        accessibilityLabel="Confirm wipe"
        placeholder="WIPE"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        style={styles.input}
      />
      <RowButton label="Wipe inventory" disabled={busy} onPress={() => void run(ACTIONS.find((action) => action.confirm) ?? ACTIONS[0])} />
    </View>
  );
}

function ProfilePanel({
  client,
  account,
  busy,
  onSaved,
  onSignOut,
}: {
  client: HomeboxClient;
  account: Account;
  busy: boolean;
  onSaved: (patch: { name: string; email: string }) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keys, setKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void client.listApiKeys().then((result) => {
      if (result.ok) setKeys(result.data);
    });
  }, [client]);

  async function saveProfile() {
    setWorking(true);
    setError(null);
    const result = await client.updateProfile(name, email);
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved({ name, email });
    setMessage("Profile saved on the server.");
  }

  async function savePassword() {
    setWorking(true);
    setError(null);
    const result = await client.changePassword(current, next);
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent("");
    setNext("");
    setMessage("Password changed on the server.");
  }

  async function addKey() {
    setWorking(true);
    setError(null);
    const result = await client.createApiKey(keyName);
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFreshToken(result.data.token);
    setKeyName("");
    setKeys((currentKeys) => [...currentKeys, result.data]);
  }

  async function removeKey(id: string) {
    const result = await client.deleteApiKey(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setKeys((currentKeys) => currentKeys.filter((key) => key.id !== id));
  }

  async function removeAccount() {
    setWorking(true);
    const result = await client.deleteProfile();
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSignOut();
  }

  return (
    <View>
      <Text style={styles.note}>Profile uses the account routes. Language and theme stay named below because they are not in this release.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={styles.input} />
      <TextInput value={email} onChangeText={setEmail} accessibilityLabel="Email" autoCapitalize="none" style={styles.input} />
      <RowButton label={working ? "Saving…" : "Save profile"} disabled={working || busy} onPress={() => void saveProfile()} />
      <Text style={styles.section}>Password</Text>
      <TextInput value={current} onChangeText={setCurrent} accessibilityLabel="Current password" secureTextEntry style={styles.input} />
      <TextInput value={next} onChangeText={setNext} accessibilityLabel="New password" secureTextEntry style={styles.input} />
      <RowButton label="Change password" disabled={working || current === "" || next === ""} onPress={() => void savePassword()} />
      <Text style={styles.section}>API keys</Text>
      <TextInput value={keyName} onChangeText={setKeyName} accessibilityLabel="API key name" placeholder="Script" placeholderTextColor={colors.muted} style={styles.input} />
      <RowButton label="Create API key" disabled={working || keyName.trim() === ""} onPress={() => void addKey()} />
      {freshToken ? <Text style={styles.note} selectable>{`New key: ${freshToken}`}</Text> : null}
      {keys.map((key) => (
        <RowButton key={key.id} label={`Delete API key ${key.name}`} onPress={() => void removeKey(key.id)} />
      ))}
      {PROFILE_GAPS.map((gap) => (
        <Text key={gap} style={styles.notice}>
          {notInThisRelease(gap)}
        </Text>
      ))}
      <Text style={styles.section}>Delete account</Text>
      {confirmDelete ? (
        <View>
          <Text style={styles.notice}>Permanently delete your account? This cannot be undone.</Text>
          <RowButton label="Cancel account deletion" disabled={working || busy} onPress={() => setConfirmDelete(false)} />
          <RowButton label="Confirm delete account" disabled={working || busy} onPress={() => void removeAccount()} />
        </View>
      ) : (
        <RowButton label="Delete account" disabled={working || busy} onPress={() => setConfirmDelete(true)} />
      )}
    </View>
  );
}

function SettingsPanel({ client, onSaved }: { client: HomeboxClient; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client.getCollection().then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName(result.data.name);
      setCurrency(result.data.currency);
    });
    void client.listCurrencies().then((result) => {
      if (result.ok) setCodes(result.data.slice(0, 8));
    });
  }, [client]);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await client.updateCollection(name, currency);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Collection settings saved on the server.");
    onSaved();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Collection name" style={styles.input} />
      <TextInput value={currency} onChangeText={setCurrency} accessibilityLabel="Currency" autoCapitalize="characters" style={styles.input} />
      <View style={styles.chips}>
        {codes.map((code) => (
          <Pressable key={code} accessibilityRole="button" accessibilityLabel={`Currency ${code}`} onPress={() => setCurrency(code)} style={styles.chip}>
            <Text style={styles.chipText}>{code}</Text>
          </Pressable>
        ))}
      </View>
      <RowButton label={busy ? "Saving…" : "Save collection settings"} disabled={busy || name.trim() === ""} onPress={() => void save()} />
    </View>
  );
}

function MembersPanel({ client, selfId }: { client: HomeboxClient; selfId: string }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await client.listMembers();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function remove(id: string) {
    const result = await client.removeMember(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows.length === 0 ? <Text style={styles.note}>No members returned.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.name || row.email}</Text>
          <Text style={styles.cardBody}>{`${row.email} · ${row.role}`}</Text>
          {row.id !== selfId ? <RowButton label={`Remove ${row.email || row.name}`} onPress={() => void remove(row.id)} /> : null}
        </View>
      ))}
    </View>
  );
}

function InvitesPanel({ client }: { client: HomeboxClient }) {
  const [rows, setRows] = useState<Array<{ id: string; expiresAt: string; uses: number; token: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listInvitations();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await client.createInvitation(1);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  async function revoke(id: string) {
    const result = await client.deleteInvitation(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <RowButton label={busy ? "Creating…" : "Create invite"} disabled={busy} onPress={() => void create()} />
      {rows.length === 0 ? <Text style={styles.note}>No invites yet.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.uses} uses</Text>
          <Text style={styles.cardBody}>{row.expiresAt}</Text>
          {row.token ? <Text style={styles.cardBody} selectable>{row.token}</Text> : null}
          <RowButton label="Revoke invite" onPress={() => void revoke(row.id)} />
        </View>
      ))}
    </View>
  );
}

function NotifiersPanel({ client }: { client: HomeboxClient }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listNotifiers();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await client.createNotifier(name, url);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setUrl("");
    await load();
  }

  async function remove(id: string) {
    const result = await client.deleteNotifier(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Notifier name" placeholder="Name" placeholderTextColor={colors.muted} style={styles.input} />
      <TextInput value={url} onChangeText={setUrl} accessibilityLabel="Notifier URL" placeholder="https://" placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} />
      <RowButton label={busy ? "Saving…" : "Add notifier"} disabled={busy} onPress={() => void create()} />
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.name}</Text>
          <Text style={styles.cardBody}>{row.url}</Text>
          <RowButton label={`Delete notifier ${row.name}`} onPress={() => void remove(row.id)} />
        </View>
      ))}
    </View>
  );
}

function TagsPanel({ client, focusId }: { client: HomeboxClient; focusId?: string }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; description: string; color: string; icon: string }>>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [editing, setEditing] = useState(focusId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listTags();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data.map((tag) => ({ id: tag.id, name: tag.name, description: tag.description ?? "", color: tag.color, icon: tag.icon ?? "" })));
  }

  useEffect(() => {
    void load();
  }, [client]);

  function beginEdit(id: string) {
    const row = rows.find((item) => item.id === id);
    setEditing(id);
    setName(row?.name ?? "");
    setDescription(row?.description ?? "");
    setColor(row?.color ?? "");
    setIcon(row?.icon ?? "");
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const input = { name: name.trim(), description, color, icon };
    const result = editing ? await client.updateTag(editing, input) : await client.createTag(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing("");
    setName("");
    setDescription("");
    setColor("");
    setIcon("");
    await load();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const result = await client.deleteTag(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (editing === id) setEditing("");
    await load();
  }

  return (
    <View>
      <Text style={styles.note}>Tags belong to this collection. Name, description, color, and icon are saved on the server.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows.length === 0 ? <Text style={styles.note}>No tags yet.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.name}</Text>
          <Text style={styles.note}>{[row.description, row.color, row.icon].filter(Boolean).join(" · ") || "No description"}</Text>
          <RowButton label={`Edit ${row.name}`} onPress={() => beginEdit(row.id)} />
          <RowButton label={`Delete ${row.name}`} disabled={busy} onPress={() => void remove(row.id)} />
        </View>
      ))}
      <Text style={styles.section}>{editing ? "Edit tag" : "New tag"}</Text>
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Tag name" placeholder="Kitchen" placeholderTextColor={colors.muted} style={styles.input} />
      <TextInput value={description} onChangeText={setDescription} accessibilityLabel="Tag description" placeholder="Description" placeholderTextColor={colors.muted} style={styles.input} />
      <TextInput value={color} onChangeText={setColor} accessibilityLabel="Tag color" placeholder="#5c7f67" placeholderTextColor={colors.muted} style={styles.input} />
      <TextInput value={icon} onChangeText={setIcon} accessibilityLabel="Tag icon" placeholder="mdi-tag" placeholderTextColor={colors.muted} style={styles.input} />
      <RowButton label={busy ? "Saving…" : editing ? "Save tag" : "Add tag"} disabled={busy || name.trim() === ""} onPress={() => void save()} />
    </View>
  );
}

function TypesPanel({ client }: { client: HomeboxClient }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; isLocation: boolean }>>([]);
  const [name, setName] = useState("");
  const [isLocation, setIsLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listEntityTypes();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await client.createEntityType(name, isLocation);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    await load();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows.map((row) => (
        <Text key={row.id} style={styles.cardTitle}>{`${row.name} · ${row.isLocation ? "location" : "item"}`}</Text>
      ))}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Entity type name" placeholder="Appliance" placeholderTextColor={colors.muted} style={styles.input} />
      <RowButton label={isLocation ? "Location type" : "Item type"} onPress={() => setIsLocation((value) => !value)} />
      <RowButton label={busy ? "Saving…" : "Add entity type"} disabled={busy || name.trim() === ""} onPress={() => void create()} />
    </View>
  );
}

function TemplatesPanel({ client, focusId }: { client: HomeboxClient; focusId?: string }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState(focusId ?? "");
  const [editName, setEditName] = useState("");
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await client.listTemplates();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.data);
  }

  useEffect(() => {
    void load();
  }, [client]);

  useEffect(() => {
    if (!focusId) return;
    void open(focusId);
  }, [client, focusId]);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await client.createTemplate(name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    await load();
    await open(result.data.id);
  }

  async function open(id: string) {
    setOpenId(id);
    const result = await client.getTemplate(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditName(result.data.name);
    setRaw(result.data.raw);
  }

  async function save() {
    if (!raw || !openId) return;
    setBusy(true);
    setError(null);
    const result = await client.saveTemplate(openId, { ...raw, name: editName });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Template saved on the server.");
    await load();
  }

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.note}>{message}</Text> : null}
      {rows.map((row) => (
        <RowButton key={row.id} label={`Open template ${row.name}`} onPress={() => void open(row.id)} />
      ))}
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Template name" placeholder="New template" placeholderTextColor={colors.muted} style={styles.input} />
      <RowButton label={busy ? "Saving…" : "Create template"} disabled={busy || name.trim() === ""} onPress={() => void create()} />
      {openId ? (
        <View>
          <Text style={styles.section}>Template</Text>
          <TextInput value={editName} onChangeText={setEditName} accessibilityLabel="Template title" style={styles.input} />
          <RowButton label="Save template" disabled={busy || !raw} onPress={() => void save()} />
        </View>
      ) : null}
    </View>
  );
}

type PickedFile = { filename: string; bytes: Uint8Array };

function WebFilePicker({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept: string;
  disabled?: boolean;
  onFile: (file: PickedFile) => void;
}) {
  if (Platform.OS !== "web") {
    return <Text style={styles.note}>{`${label} uses the browser file control on the web client.`}</Text>;
  }
  return createElement("input", {
    type: "file",
    accept,
    "aria-label": label,
    disabled,
    onChange: (event: { target?: { files?: ArrayLike<{ name: string; arrayBuffer: () => Promise<ArrayBuffer> }> | null; value?: string } }) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        onFile({ filename: file.name || "upload", bytes: new Uint8Array(buffer) });
        if (input) input.value = "";
      });
    },
    style: { marginTop: 12, fontSize: 14 },
  });
}

function RowButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 48, maxWidth: 640, width: "100%", alignSelf: "center" },
  back: { alignSelf: "flex-start", marginBottom: 16 },
  backText: { fontSize: 16, fontWeight: "600", color: colors.primary },
  kicker: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  title: { marginTop: 8, fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  note: { marginTop: 14, fontSize: 14, lineHeight: 20, color: colors.muted },
  notice: { marginTop: 16, fontSize: 16, lineHeight: 22, color: colors.text, fontWeight: "600" },
  error: { marginTop: 14, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  section: { marginTop: 22, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  card: { marginTop: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  cardBody: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.muted },
  input: { marginTop: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.input, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: colors.text },
  area: { minHeight: 120, textAlignVertical: "top" },
  button: { marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, paddingHorizontal: 12, alignItems: "center", backgroundColor: colors.card },
  buttonPressed: { backgroundColor: colors.background },
  buttonText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  preview: { marginTop: 12, width: "100%", height: 180, backgroundColor: colors.card, borderRadius: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.card },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "600" },
});
