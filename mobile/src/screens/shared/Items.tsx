import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

export type ItemRow = {
  id: string;
  name: string;
  quantity: number;
  parentName?: string | null;
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

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

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
