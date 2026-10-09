import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Account } from "../session/session";
import { colors } from "../theme";

type Props = {
  account: Account;
  busy: boolean;
  onSignOut: () => void;
  onBack?: () => void;
};

export function AccountScreen({ account, busy, onSignOut, onBack }: Props) {
  const name = account.name.trim() || account.email || "HomeBox account";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {onBack ? (
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
            <Text style={styles.backText}>Inventory</Text>
          </Pressable>
        ) : null}
        <Text style={styles.kicker}>Signed in</Text>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{account.email}</Text>

        <View style={styles.card}>
          <Row label="Server" value={account.serverUrl} />
          <Row label="Account" value={account.id} last={!account.defaultGroupId} />
          {account.defaultGroupId ? <Row label="Collection" value={account.defaultGroupId} last /> : null}
        </View>

        <Text style={styles.note}>
          This account was just confirmed with the server. Closing the app does not open a local inventory. The next launch asks the server again.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onSignOut}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonBusy]}
        >
          <Text style={styles.buttonText}>{busy ? "Signing out…" : "Sign out"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 40, maxWidth: 520, width: "100%", alignSelf: "center" },
  back: { alignSelf: "flex-start", marginBottom: 16 },
  backText: { fontSize: 16, fontWeight: "600", color: colors.primary },
  kicker: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  name: { marginTop: 8, fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  email: { marginTop: 4, fontSize: 16, color: colors.muted },
  card: {
    marginTop: 24,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: { paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  rowValue: { marginTop: 4, fontSize: 16, lineHeight: 22, color: colors.text },
  note: { marginTop: 18, fontSize: 14, lineHeight: 20, color: colors.muted },
  button: {
    marginTop: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { backgroundColor: colors.background },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
