import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EntitySummary, GroupSummary, TreeNode } from "../api/client";
import { colors } from "../theme";

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
  onRefresh: () => void;
  onSelectGroup: (id: string) => void;
  onSelectTab: (tab: Tab) => void;
  onOpenItem: (id: string) => void;
  onOpenLocation: (id: string) => void;
  onCreateItem: () => void;
  onCreateLocation: () => void;
  onAccount: () => void;
  onSignOut: () => void;
};

export function InventoryScreen(props: Props) {
  const locationRows = props.tree.length > 0 ? flattenLocations(props.tree) : props.locations.map((location) => ({ ...location, depth: 0, type: "location" }));

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
          <Pressable accessibilityRole="button" onPress={props.onAccount} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Account</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={props.onSignOut} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {props.groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {props.groups.map((group) => {
            const selected = group.id === props.groupId;
            return (
              <Pressable
                key={group.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => props.onSelectGroup(group.id)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{group.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.tabs}>
        <TabButton label="Items" selected={props.tab === "items"} onPress={() => props.onSelectTab("items")} />
        <TabButton label="Locations" selected={props.tab === "locations"} onPress={() => props.onSelectTab("locations")} />
      </View>

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

        {!props.loading && props.tab === "items" && props.items.length === 0 ? (
          <Text style={styles.empty}>{props.error ? "No items to show until the server answers." : "No items in this collection yet."}</Text>
        ) : null}

        {!props.loading && props.tab === "locations" && locationRows.length === 0 ? (
          <Text style={styles.empty}>{props.error ? "No locations to show until the server answers." : "No locations yet. Add one to file an item in it."}</Text>
        ) : null}

        {props.tab === "items"
          ? props.items.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" onPress={() => props.onOpenItem(item.id)} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowMeta}>
                    Qty {formatQuantity(item.quantity)}
                    {item.parentName ? ` · ${item.parentName}` : ""}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))
          : locationRows.map((location) => (
              <Pressable
                key={location.id}
                accessibilityRole="button"
                onPress={() => props.onOpenLocation(location.id)}
                style={[styles.row, { paddingLeft: 16 + location.depth * 16 }]}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{location.name}</Text>
                  <Text style={styles.rowMeta}>{location.depth > 0 ? "Inside another location" : "Top level"}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
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

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
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
  chips: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 7 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  chipTextSelected: { color: colors.onPrimary },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginTop: 14, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 4 },
  tab: { flex: 1, alignItems: "center", borderRadius: 9, paddingVertical: 8 },
  tabSelected: { backgroundColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  tabTextSelected: { color: colors.onPrimary },
  error: { marginHorizontal: 20, marginTop: 12, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  toolbarNote: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
  empty: { marginTop: 24, fontSize: 16, lineHeight: 22, color: colors.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  rowMeta: { marginTop: 3, fontSize: 14, color: colors.muted },
  chevron: { marginLeft: 8, fontSize: 22, color: colors.muted },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.background },
  primary: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});
