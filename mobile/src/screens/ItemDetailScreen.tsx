import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EntityDetail, EntitySummary } from "../api/client";
import { colors } from "../theme";

export type ServerPhoto = {
  id: string;
  title: string;
  url: string | null;
};

type Props = {
  kind: "item" | "location";
  detail: EntityDetail | null;
  filedItems: EntitySummary[];
  photos: ServerPhoto[];
  uploadingPhoto: boolean;
  photoError: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onEdit?: () => void;
  onFileHere?: () => void;
  onOpenItem?: (id: string) => void;
  onTakePhoto?: () => void;
  onPickPhoto?: () => void;
};

export function ItemDetailScreen(props: Props) {
  const detail = props.detail;
  const title = detail?.name ?? (props.loading ? "Loading…" : "Not on the server");

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" onPress={props.onBack} style={styles.back}>
          <Text style={styles.backText}>{props.kind === "item" ? "Items" : "Locations"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onRefresh} style={styles.back}>
          <Text style={styles.backText}>Refresh</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.kicker}>{props.kind === "item" ? "Item" : "Location"}</Text>
        <Text style={styles.title}>{title}</Text>
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
        {props.loading && !detail ? <Text style={styles.note}>Asking the server…</Text> : null}

        {detail ? (
          <View style={styles.card}>
            <Row label="Server id" value={detail.id} />
            {props.kind === "item" ? <Row label="Quantity" value={String(detail.quantity)} /> : null}
            <Row label="Filed in" value={detail.parentName ?? "Not filed in a location"} />
            <Row label="Description" value={detail.description || "No description"} last />
          </View>
        ) : null}

        {props.kind === "item" && detail ? (
          <View style={styles.photos}>
            <Text style={styles.section}>Photos</Text>
            <Text style={styles.note}>Stored by the server. Opening this item again loads them from there, not from the camera roll.</Text>
            {props.photoError ? <Text style={styles.error}>{props.photoError}</Text> : null}
            {props.uploadingPhoto ? <Text style={styles.note}>Uploading to the server…</Text> : null}
            {props.photos.length === 0 && !props.uploadingPhoto ? <Text style={styles.note}>No photo on the server yet.</Text> : null}
            {props.photos.map((photo) => (
              <View key={photo.id} style={styles.photoCard}>
                {photo.url ? (
                  <Image source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={photo.title} />
                ) : (
                  <Text style={styles.note}>The server has this photo, but this session cannot display it.</Text>
                )}
                <Text style={styles.photoTitle}>{photo.title}</Text>
              </View>
            ))}
            <View style={styles.photoActions}>
              <Pressable
                accessibilityRole="button"
                disabled={props.uploadingPhoto}
                onPress={props.onTakePhoto}
                style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed, props.uploadingPhoto && styles.disabled]}
              >
                <Text style={styles.secondaryText}>Take photo</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={props.uploadingPhoto}
                onPress={props.onPickPhoto}
                style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed, props.uploadingPhoto && styles.disabled]}
              >
                <Text style={styles.secondaryText}>Choose from library</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text style={styles.note}>This is the row the server returned just now. Closing the app does not keep a copy.</Text>

        {props.kind === "location" && detail ? (
          <View style={styles.filed}>
            <Text style={styles.section}>Items filed here</Text>
            {props.filedItems.length === 0 ? <Text style={styles.note}>None yet.</Text> : null}
            {props.filedItems.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" onPress={() => props.onOpenItem?.(item.id)} style={styles.row}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>Qty {item.quantity}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {detail ? (
        <View style={styles.footer}>
          {props.onEdit ? (
            <Pressable accessibilityRole="button" onPress={props.onEdit} style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
              <Text style={styles.primaryText}>Edit</Text>
            </Pressable>
          ) : null}
          {props.onFileHere ? (
            <Pressable accessibilityRole="button" onPress={props.onFileHere} style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, props.onEdit && styles.second]}>
              <Text style={styles.primaryText}>File an item here</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8 },
  back: { paddingVertical: 8 },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  kicker: { marginTop: 8, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.mark },
  title: { marginTop: 4, fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  error: { marginTop: 14, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  card: { marginTop: 18, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16 },
  field: { paddingVertical: 14 },
  fieldBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  fieldValue: { marginTop: 4, fontSize: 16, lineHeight: 22, color: colors.text },
  note: { marginTop: 14, fontSize: 14, lineHeight: 20, color: colors.muted },
  filed: { marginTop: 8 },
  section: { marginTop: 18, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  row: { marginTop: 8, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12 },
  photos: { marginTop: 8 },
  photoCard: { marginTop: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  photo: { width: "100%", height: 220, backgroundColor: colors.line },
  photoTitle: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.muted },
  photoActions: { marginTop: 12, gap: 8 },
  secondary: { borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, alignItems: "center", backgroundColor: colors.card },
  secondaryPressed: { backgroundColor: colors.background },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowMeta: { marginTop: 2, fontSize: 14, color: colors.muted },
  footer: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  primary: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  second: { marginTop: 0 },
});
