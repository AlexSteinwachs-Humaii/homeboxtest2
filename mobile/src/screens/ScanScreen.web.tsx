import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../theme";
import { noMatchCopy, type ScanMatch, type ScanResolution } from "../scan/lookup";
import { ScanLock } from "../scan/scan-lock";

type Props = {
  onBack: () => void;
  onLookup: (code: string) => Promise<ScanResolution>;
  onOpen: (match: ScanMatch) => void;
};

// Camera scanner stays on the phone (ScanScreen.tsx). The browser keeps the
// same lookup field so a label can still be typed. Item layout is not forked.
export function ScanScreen({ onBack, onLookup, onOpen }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResolution | null>(null);
  const lock = useRef(new ScanLock());

  async function lookup(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || !lock.current.begin(false)) return;
    setCode(raw);
    setBusy(true);
    setResult(null);
    let resolved: ScanResolution;
    try {
      resolved = await onLookup(trimmed);
    } catch {
      resolved = { status: "error", message: "Could not look up this code. Try again." };
    }
    lock.current.finish();
    setBusy(false);
    if (resolved.status === "match" && resolved.matches.length === 1) {
      const match = resolved.matches[0];
      if (match) onOpen(match);
      return;
    }
    setResult(resolved);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Scan</Text>
      </View>
      <View style={styles.entry}>
        <Text style={styles.hint}>The camera scanner is on the phone. Type the barcode, QR link, or asset id to look it up on the server.</Text>
        <Text style={styles.label}>Code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Barcode, QR link, or asset id"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          onSubmitEditing={() => void lookup(code)}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || code.trim() === ""}
          onPress={() => void lookup(code)}
          style={({ pressed }) => [styles.primary, (busy || code.trim() === "") && styles.busy, pressed && styles.primaryPressed]}
        >
          <Text style={styles.primaryText}>{busy ? "Looking up…" : "Look up"}</Text>
        </Pressable>
        {result?.status === "error" ? <Text style={styles.error}>{result.message}</Text> : null}
        {result?.status === "none" ? <Text style={styles.none}>{noMatchCopy(result.code, result.productName)}</Text> : null}
        {result?.status === "match" ? (
          <View style={styles.matches}>
            <Text style={styles.hint}>Several items match. Open one.</Text>
            {result.matches.map((match) => (
              <Pressable key={match.id} accessibilityRole="button" onPress={() => onOpen(match)} style={styles.row}>
                <Text style={styles.rowTitle}>{match.name}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  textButton: { paddingVertical: 4 },
  textButtonLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  entry: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  label: { marginTop: 12, fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  primary: { marginTop: 10, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  busy: { opacity: 0.7 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { marginTop: 12, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  none: { marginTop: 12, backgroundColor: colors.card, color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, lineHeight: 21 },
  matches: { marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  chevron: { marginLeft: 8, fontSize: 22, color: colors.muted },
});
