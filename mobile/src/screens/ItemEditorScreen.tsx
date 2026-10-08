import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EntitySummary } from "../api/client";
import { colors } from "../theme";

export type EditorValues = {
  name: string;
  description: string;
  quantity: string;
  parentId: string | null;
};

type Props = {
  mode: "create-item" | "edit-item" | "create-location";
  initial: EditorValues;
  locations: EntitySummary[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (values: EditorValues) => void;
};

export function ItemEditorScreen({ mode, initial, locations, busy, error, onBack, onSubmit }: Props) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [parentId, setParentId] = useState<string | null>(initial.parentId);
  const isLocation = mode === "create-location";
  const title = mode === "edit-item" ? "Edit item" : isLocation ? "New location" : "New item";

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
          <Text style={styles.kicker}>Saved on the server</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {isLocation
              ? "A location is only a place to file items. This does not edit the whole tree."
              : "Choose a location if this collection has one. The server stores the item, not this phone."}
          </Text>

          <View style={styles.card}>
            <Field label="Name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={isLocation ? "Kitchen" : "Desk lamp"}
                placeholderTextColor={colors.muted}
                style={styles.input}
                accessibilityLabel="Name"
                editable={!busy}
              />
            </Field>
            {isLocation ? null : (
              <Field label="Description">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Optional"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                  accessibilityLabel="Description"
                  multiline
                  editable={!busy}
                />
              </Field>
            )}
            {isLocation ? null : (
              <Field label="Quantity">
                <TextInput
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  accessibilityLabel="Quantity"
                  editable={!busy}
                />
              </Field>
            )}
            <Text style={styles.label}>{isLocation ? "Inside" : "File in"}</Text>
            <LocationChoice label="Not inside a location" selected={parentId === null} onPress={() => setParentId(null)} />
            {locations.map((location) => (
              <LocationChoice
                key={location.id}
                label={location.parentName ? `${location.name} · in ${location.parentName}` : location.name}
                selected={parentId === location.id}
                onPress={() => setParentId(location.id)}
              />
            ))}
            {locations.length === 0 ? <Text style={styles.hint}>No locations on the server yet. You can still save, then file it later.</Text> : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onSubmit({ name, description, quantity, parentId })}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, busy && styles.busy]}
          >
            <Text style={styles.primaryText}>{busy ? "Saving…" : "Save to server"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function LocationChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" },
  back: { alignSelf: "flex-start", paddingVertical: 8 },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  kicker: { marginTop: 8, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  title: { marginTop: 4, fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  subtitle: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.muted },
  card: { marginTop: 18, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
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
  multiline: { minHeight: 88, textAlignVertical: "top" },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  choiceSelected: {},
  choiceText: { flex: 1, fontSize: 16, color: colors.text },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  hint: { marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { marginTop: 14, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  primary: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  busy: { opacity: 0.7 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});
