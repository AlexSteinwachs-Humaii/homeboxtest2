import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

export type LocationRow = {
  id: string;
  name: string;
  depth: number;
};

type Props = {
  rows: LocationRow[];
  loading: boolean;
  error: string | null;
  onOpenLocation: (id: string) => void;
};

// Location list. Same module on the phone and in the browser.
export function Locations(props: Props) {
  return (
    <View>
      {!props.loading && props.rows.length === 0 ? (
        <Text style={styles.empty}>{props.error ? "No locations to show until the server answers." : "No locations yet. Add one to file an item in it."}</Text>
      ) : null}
      {props.rows.map((location) => (
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
    </View>
  );
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
