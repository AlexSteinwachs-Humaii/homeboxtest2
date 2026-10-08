import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors } from "../../theme";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  onScan: () => void;
};

// Search field. The query is sent as typed; accent folding stays on the server.
export function Search(props: Props) {
  return (
    <View style={styles.searchRow}>
      <TextInput
        value={props.query}
        onChangeText={props.onQueryChange}
        onSubmitEditing={props.onSubmitSearch}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search items"
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        accessibilityLabel="Search items"
        style={styles.searchInput}
      />
      <Pressable accessibilityRole="button" onPress={props.onScan} style={styles.scanButton}>
        <Text style={styles.scanButtonText}>Scan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 12 },
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
  scanButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  scanButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
});
