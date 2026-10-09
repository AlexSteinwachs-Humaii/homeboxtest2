import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../theme";

export function LoadingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.title}>HomeBox</Text>
        <Text style={styles.body}>Checking your session with the server…</Text>
      </View>
    </SafeAreaView>
  );
}

type OfflineProps = {
  serverUrl: string;
  message: string;
  busy: boolean;
  onRetry: () => void;
  onForget: () => void;
};

export function OfflineScreen({ serverUrl, message, busy, onRetry, onForget }: OfflineProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.kicker}>Server unreachable</Text>
        <Text style={styles.title}>Can't open your account</Text>
        <Text style={styles.body}>{message}</Text>
        <Text style={styles.server} selectable>
          {serverUrl}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onRetry}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, busy && styles.busy]}
        >
          <Text style={styles.primaryText}>{busy ? "Trying again…" : "Try again"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onForget} style={styles.secondary}>
          <Text style={styles.secondaryText}>Sign in again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 24, maxWidth: 520, width: "100%", alignSelf: "center" },
  kicker: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.danger },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, marginBottom: 8 },
  body: { fontSize: 16, lineHeight: 22, color: colors.muted },
  server: { marginTop: 12, fontSize: 14, color: colors.text },
  primary: { marginTop: 24, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  busy: { opacity: 0.7 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  secondary: { marginTop: 12, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
});
