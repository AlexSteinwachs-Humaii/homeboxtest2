import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MaintenanceEntry } from "../api/client";
import { isComplete, sortMaintenance } from "../maintenance/maintenance";
import { colors } from "../theme";

type Filter = "due" | "done" | "all";

type Props = {
  groupName: string;
  entries: MaintenanceEntry[];
  filter: Filter;
  loading: boolean;
  refreshing: boolean;
  completingId: string | null;
  error: string | null;
  onFilter: (filter: Filter) => void;
  onRefresh: () => void;
  onComplete: (entry: MaintenanceEntry) => void;
  onOpenItem: (id: string) => void;
  onBack: () => void;
};

export function MaintenanceScreen(props: Props) {
  const sorted = sortMaintenance(props.entries);
  const visible = sorted.filter((entry) => {
    if (props.filter === "due") return !isComplete(entry);
    if (props.filter === "done") return isComplete(entry);
    return true;
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Items</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onRefresh} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Refresh</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.kicker}>Maintenance</Text>
        <Text style={styles.title}>{props.groupName || "Collection"}</Text>
        <Text style={styles.note}>
          {Platform.OS === "web"
            ? "Due work for this collection, loaded from the server."
            : "Due work for this collection, loaded from the server. This phone does not keep a maintenance log."}
        </Text>
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}

        <View style={styles.filters}>
          <FilterChip label="Due" selected={props.filter === "due"} onPress={() => props.onFilter("due")} />
          <FilterChip label="Done" selected={props.filter === "done"} onPress={() => props.onFilter("done")} />
          <FilterChip label="All" selected={props.filter === "all"} onPress={() => props.onFilter("all")} />
        </View>

        {props.loading && !props.refreshing ? <Text style={styles.empty}>Loading from the server…</Text> : null}
        {!props.loading && visible.length === 0 ? (
          <Text style={styles.empty}>
            {props.error
              ? "No maintenance to show until the server answers."
              : props.filter === "done"
                ? "Nothing completed in this collection yet."
                : "Nothing due in this collection."}
          </Text>
        ) : null}

        {visible.map((entry) => {
          const done = isComplete(entry);
          return (
            <View key={entry.id} style={styles.card}>
              <Pressable accessibilityRole="button" disabled={!entry.itemID} onPress={() => entry.itemID && props.onOpenItem(entry.itemID)}>
                <Text style={styles.cardTitle}>{entry.name}</Text>
                <Text style={styles.meta}>{entry.itemName || "Item"}</Text>
              </Pressable>
              {entry.description ? <Text style={styles.body}>{entry.description}</Text> : null}
              <Text style={styles.meta}>{done ? `Completed ${entry.completedDate}` : `Scheduled ${entry.scheduledDate || "unscheduled"}`}</Text>
              {entry.cost && entry.cost !== "0" ? <Text style={styles.meta}>Cost {entry.cost}</Text> : null}
              {done ? (
                <Text style={styles.done}>Complete</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={props.completingId === entry.id}
                  onPress={() => props.onComplete(entry)}
                  style={({ pressed }) => [styles.complete, pressed && styles.completePressed, props.completingId === entry.id && styles.busy]}
                >
                  <Text style={styles.completeText}>{props.completingId === entry.id ? "Saving…" : "Mark complete"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8 },
  textButton: { paddingVertical: 8 },
  textButtonLabel: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  kicker: { marginTop: 8, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  title: { marginTop: 4, fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  note: { marginTop: 8, fontSize: 14, lineHeight: 20, color: colors.muted },
  error: { marginTop: 12, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  filters: { flexDirection: "row", gap: 8, marginTop: 16 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 7 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  chipTextSelected: { color: colors.onPrimary },
  empty: { marginTop: 24, fontSize: 16, lineHeight: 22, color: colors.muted },
  card: { marginTop: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 16 },
  cardTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  meta: { marginTop: 4, fontSize: 14, color: colors.muted },
  body: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.text },
  done: { marginTop: 12, fontSize: 14, fontWeight: "700", color: colors.mark },
  complete: { marginTop: 12, alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  completePressed: { backgroundColor: colors.primaryPressed },
  busy: { opacity: 0.7 },
  completeText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
});
