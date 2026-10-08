import { useEffect, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EntitySummary, GroupSummary, TreeNode } from "../api/client";
import { colors, homebox } from "../theme";
import { Items, Locations, Search } from "./inventory-ui";

type Tab = "items" | "locations";

type Props = {
  email: string;
  groupName: string;
  groups: GroupSummary[];
  groupId: string;
  tab: Tab;
  items: EntitySummary[];
  locations: EntitySummary[];
  tree: TreeNode[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  query: string;
  searchActive: boolean;
  searching: boolean;
  onQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  onScan: () => void;
  onMaintenance: () => void;
  onTools: () => void;
  onRefresh: () => void;
  onSelectGroup: (id: string) => void;
  onCreateGroup: (name: string) => void;
  creatingGroup: boolean;
  groupError: string | null;
  onSelectTab: (tab: Tab) => void;
  onOpenItem: (id: string) => void;
  onOpenLocation: (id: string) => void;
  onCreateItem: () => void;
  onCreateLocation: () => void;
  onAccount: () => void;
  onSignOut: () => void;
};

export function CollectionSwitcher(props: {
  groups: GroupSummary[];
  groupId: string;
  creatingGroup: boolean;
  groupError: string | null;
  onSelectGroup: (id: string) => void;
  onCreateGroup: (name: string) => void;
  compact?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [collectionName, setCollectionName] = useState("");

  useEffect(() => {
    setCreating(false);
    setCollectionName("");
  }, [props.groupId]);

  return (
    <View style={props.compact ? styles.collectionStack : undefined}>
      <View style={props.compact ? styles.collectionStack : styles.collectionBar}>
        <ScrollView horizontal={!props.compact} showsHorizontalScrollIndicator={false} contentContainerStyle={props.compact ? styles.chipsStacked : styles.chips}>
          {props.groups.map((group) => {
            const selected = group.id === props.groupId;
            return (
              <Pressable
                key={group.id}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${group.name}`}
                accessibilityState={{ selected }}
                onPress={() => props.onSelectGroup(group.id)}
                style={[styles.chip, selected && styles.chipSelected, props.compact && styles.chipStacked]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{group.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="New collection" onPress={() => setCreating(true)} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>New collection</Text>
        </Pressable>
      </View>
      {creating ? (
        <View style={styles.createCollection}>
          <TextInput
            value={collectionName}
            onChangeText={setCollectionName}
            placeholder="Cabin"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Collection name"
            editable={!props.creatingGroup}
            style={styles.collectionInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create collection"
            disabled={props.creatingGroup}
            onPress={() => props.onCreateGroup(collectionName)}
            style={styles.textButton}
          >
            <Text style={styles.textButtonLabel}>{props.creatingGroup ? "Creating…" : "Create collection"}</Text>
          </Pressable>
        </View>
      ) : null}
      {props.groupError ? <Text style={styles.error}>{props.groupError}</Text> : null}
    </View>
  );
}

export function InventoryScreen(props: Props) {
  const showingItems = props.searchActive || props.tab === "items";
  const locationRows = props.tree.length > 0 ? flattenLocations(props.tree) : props.locations.map((location) => ({ ...location, depth: 0, type: "location" }));

  if (Platform.OS === "web") {
    const heading = props.tab === "items" ? "Items" : "Locations";
    const count = showingItems ? props.items.length : locationRows.length;
    return (
      <ScrollView contentContainerStyle={styles.webPage}>
        <View style={styles.webHeadingRow}>
          <Text style={styles.webHeading}>{heading}</Text>
          <Text style={styles.webCount}>{count}</Text>
        </View>
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
        {props.loading && !props.refreshing ? <Text style={styles.empty}>Loading from the server…</Text> : null}
        {showingItems ? (
          <Items
            items={props.items}
            loading={props.loading}
            error={props.error}
            searchActive={props.searchActive}
            searching={props.searching}
            onOpenItem={props.onOpenItem}
          />
        ) : (
          <Locations rows={locationRows} loading={props.loading} error={props.error} onOpenLocation={props.onOpenLocation} />
        )}
        <Pressable accessibilityRole="button" onPress={props.onRefresh} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Refresh</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>HomeBox</Text>
          <Text style={styles.title}>{props.tab === "items" ? "Items" : "Locations"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {props.groupName || "Collection"} · {props.email}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" onPress={props.onMaintenance} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Maintenance</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Tools" onPress={props.onTools} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Tools</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onAccount} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Account</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onSignOut} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <CollectionSwitcher
        groups={props.groups}
        groupId={props.groupId}
        creatingGroup={props.creatingGroup}
        groupError={props.groupError}
        onSelectGroup={props.onSelectGroup}
        onCreateGroup={props.onCreateGroup}
      />

      <View style={styles.tabs}>
        <TabButton label="Items" selected={props.tab === "items"} onPress={() => props.onSelectTab("items")} />
        <TabButton label="Locations" selected={props.tab === "locations"} onPress={() => props.onSelectTab("locations")} />
      </View>

      <Search query={props.query} onQueryChange={props.onQueryChange} onSubmitSearch={props.onSubmitSearch} onScan={props.onScan} />

      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.toolbar}>
          <Text style={styles.toolbarNote}>Pulled from the server. Nothing is kept on this phone.</Text>
          <Pressable accessibilityRole="button" onPress={props.onRefresh} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Refresh</Text>
          </Pressable>
        </View>

        {props.loading && !props.refreshing ? <Text style={styles.empty}>Loading from the server…</Text> : null}

        {showingItems ? (
          <Items
            items={props.items}
            loading={props.loading}
            error={props.error}
            searchActive={props.searchActive}
            searching={props.searching}
            onOpenItem={props.onOpenItem}
          />
        ) : (
          <Locations rows={locationRows} loading={props.loading} error={props.error} onOpenLocation={props.onOpenLocation} />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={props.tab === "items" ? props.onCreateItem : props.onCreateLocation}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        >
          <Text style={styles.primaryText}>{props.tab === "items" ? "New item" : "New location"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.tab, selected && styles.tabSelected]}>
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function flattenLocations(nodes: TreeNode[], depth = 0): Array<{ id: string; name: string; depth: number }> {
  const rows: Array<{ id: string; name: string; depth: number }> = [];
  for (const node of nodes) {
    if (node.type === "item") continue;
    rows.push({ id: node.id, name: node.name, depth });
    rows.push(...flattenLocations(node.children, depth + 1));
  }
  return rows;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, gap: 12 },
  headerCopy: { flex: 1 },
  headerActions: { alignItems: "flex-end", gap: 4 },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  title: { marginTop: 2, fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  subtitle: { marginTop: 2, fontSize: 14, color: colors.muted },
  textButton: { paddingVertical: 4, paddingHorizontal: 2 },
  textButtonLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  collectionBar: { flexDirection: "row", alignItems: "center", paddingRight: 12 },
  chips: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 8 },
  createCollection: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 8 },
  collectionInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
  },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 7 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  chipTextSelected: { color: colors.onPrimary },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginTop: 14, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 4 },
  tab: { flex: 1, alignItems: "center", borderRadius: 9, paddingVertical: 8 },
  tabSelected: { backgroundColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  tabTextSelected: { color: colors.onPrimary },
  collectionStack: { gap: 4 },
  chipsStacked: { gap: 8, paddingVertical: 4 },
  chipStacked: { alignSelf: "flex-start" },
  webPage: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 40, maxWidth: 1120, width: "100%", alignSelf: "center" },
  webHeadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  webHeading: { fontSize: 18, fontWeight: "600", color: homebox.text },
  webCount: {
    backgroundColor: homebox.primary,
    color: homebox.primaryText,
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 13,
    fontWeight: "600",
  },
  error: { marginHorizontal: 20, marginTop: 12, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  toolbarNote: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
  empty: { marginTop: 24, fontSize: 16, lineHeight: 22, color: colors.muted },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.background },
  primary: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});
