import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, homebox } from "../../theme";
import { Icon } from "../web-marks";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  onScan: () => void;
  variant?: "default" | "header";
};

// Search field. The query is sent as typed; accent folding stays on the server.
export function Search(props: Props) {
  const header = props.variant === "header";
  return (
    <View style={[styles.searchRow, header && styles.searchRowHeader]}>
      <TextInput
        value={props.query}
        onChangeText={props.onQueryChange}
        onSubmitEditing={props.onSubmitSearch}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={header ? "Search" : "Search items"}
        placeholderTextColor={header ? "#8a8a8a" : colors.muted}
        returnKeyType="search"
        accessibilityLabel="Search items"
        style={[styles.searchInput, header && styles.searchInputHeader]}
      />
      {header ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Run search" onPress={props.onSubmitSearch} style={styles.iconButton}>
            <Icon name="magnify" size={20} color={homebox.primaryText} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open scanner" onPress={props.onScan} style={styles.iconButton}>
            <Icon name="scan" size={20} color={homebox.primaryText} />
          </Pressable>
        </>
      ) : (
        <Pressable accessibilityRole="button" onPress={props.onScan} style={styles.scanButton}>
          <Text style={styles.scanButtonText}>Scan</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 12 },
  searchRowHeader: { marginHorizontal: 0, marginTop: 0, width: 420, maxWidth: "100%", justifyContent: "flex-end" },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  searchInputHeader: {
    backgroundColor: "#ffffff",
    borderColor: "transparent",
    borderRadius: 6,
    paddingVertical: 8,
    color: "#333333",
  },
  scanButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  scanButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: homebox.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
