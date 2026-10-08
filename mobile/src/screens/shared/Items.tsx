import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, homebox } from "../../theme";

export type ItemRow = {
  id: string;
  name: string;
  quantity: number;
  parentName?: string | null;
  assetId?: string;
};

type Props = {
  items: ItemRow[];
  loading: boolean;
  error: string | null;
  searchActive: boolean;
  searching: boolean;
  onOpenItem: (id: string) => void;
};

// Item list. The phone and the browser import this from inventory-ui.
export function Items(props: Props) {
  if (Platform.OS === "web") return <ItemTable {...props} />;
  return (
    <View>
      {!props.loading && props.items.length === 0 ? (
        <Text style={styles.empty}>
          {props.searchActive
            ? props.searching
              ? "Searching the server…"
              : props.error
                ? "No items to show until the server answers."
                : "No items match this search."
            : props.error
              ? "No items to show until the server answers."
              : "No items in this collection yet."}
        </Text>
      ) : null}
      {props.items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => props.onOpenItem(item.id)}
          style={styles.row}
        >
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowMeta}>
              Qty {formatQuantity(item.quantity)}
              {item.parentName ? ` · ${item.parentName}` : ""}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ItemTable(props: Props) {
  return (
    <View>
      {!props.loading && props.items.length === 0 ? (
        <Text style={styles.empty}>
          {props.searchActive
            ? props.searching
              ? "Searching the server…"
              : props.error
                ? "No items to show until the server answers."
                : "No items match this search."
            : props.error
              ? "No items to show until the server answers."
              : "No items in this collection yet."}
        </Text>
      ) : null}
      {props.items.length > 0 ? (
        <View style={table.card}>
          <View style={table.head}>
            <Text style={[table.th, table.nameCol]}>Name</Text>
            <Text style={[table.th, table.qtyCol]}>Quantity</Text>
            <Text style={[table.th, table.locCol]}>Location</Text>
            <Text style={[table.th, table.assetCol]}>Asset ID</Text>
          </View>
          {props.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => props.onOpenItem(item.id)}
              style={table.row}
            >
              <Text style={[table.cell, table.nameCol, table.name]}>{item.name}</Text>
              <View style={table.qtyCol}>
                <Text style={table.badge}>{formatQuantity(item.quantity)}</Text>
              </View>
              <Text style={[table.cell, table.locCol]}>{item.parentName || "—"}</Text>
              <Text style={[table.cell, table.assetCol]}>{item.assetId || ""}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

const table = StyleSheet.create({
  card: {
    backgroundColor: homebox.card,
    borderRadius: homebox.radius,
    borderWidth: 1,
    borderColor: homebox.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  head: { flexDirection: "row", backgroundColor: "#f7f7f7", borderBottomWidth: 1, borderBottomColor: homebox.border, paddingHorizontal: 12, paddingVertical: 10 },
  th: { fontSize: 13, fontWeight: "600", color: homebox.muted },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5" },
  cell: { fontSize: 15, color: homebox.text },
  name: { fontWeight: "600" },
  nameCol: { flex: 2 },
  qtyCol: { width: 110 },
  locCol: { flex: 1.2 },
  assetCol: { width: 110 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: homebox.primary,
    color: homebox.primaryText,
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 13,
    fontWeight: "600",
  },
});

const styles = StyleSheet.create({
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
});
