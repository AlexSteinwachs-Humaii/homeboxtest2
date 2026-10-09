import { createElement } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

export type AttachablePhoto = {
  id: string;
  title: string;
  url: string | null;
};

export type WebPhotoFile = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

type Props = {
  photos: AttachablePhoto[];
  uploading: boolean;
  error: string | null;
  onTakePhoto?: () => void;
  onPickPhoto?: () => void;
  onWebFile?: (file: WebPhotoFile) => void;
};

type BrowserFile = {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type FileChange = {
  target?: { files?: ArrayLike<BrowserFile> | null; value?: string };
};

// Photo attach. The file still uploads to the server; this is only the shared UI.
export function PhotoAttach(props: Props) {
  return (
    <View style={styles.photos}>
      <Text style={styles.section}>Photos</Text>
      <Text style={styles.note}>Stored by the server. Opening this item again loads them from there, not from the camera roll.</Text>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      {props.uploading ? <Text style={styles.note}>Uploading to the server…</Text> : null}
      {props.photos.length === 0 && !props.uploading ? <Text style={styles.note}>No photo on the server yet.</Text> : null}
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
      {Platform.OS === "web" && props.onWebFile ? (
        <WebFileInput disabled={props.uploading} onFile={props.onWebFile} />
      ) : null}
      <View style={styles.photoActions}>
        <Pressable
          accessibilityRole="button"
          disabled={props.uploading}
          onPress={props.onTakePhoto}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed, props.uploading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>Take photo</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={props.uploading}
          onPress={props.onPickPhoto}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed, props.uploading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>Choose from library</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WebFileInput({ disabled, onFile }: { disabled: boolean; onFile: (file: WebPhotoFile) => void }) {
  return createElement("input", {
    type: "file",
    accept: "image/*",
    "aria-label": "Attach a photo",
    disabled,
    onChange: (event: FileChange) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        onFile({
          filename: file.name || "photo.jpg",
          mimeType: file.type || "image/jpeg",
          bytes: new Uint8Array(buffer),
        });
        if (input) input.value = "";
      });
    },
    style: { marginTop: 12, fontSize: 14 },
  });
}

const styles = StyleSheet.create({
  photos: { marginTop: 8 },
  section: { marginTop: 18, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted },
  note: { marginTop: 14, fontSize: 14, lineHeight: 20, color: colors.muted },
  error: { marginTop: 14, backgroundColor: colors.dangerBg, color: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  photoCard: { marginTop: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  photo: { width: "100%", height: 220, backgroundColor: colors.line },
  photoTitle: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.muted },
  photoActions: { marginTop: 12, gap: 8 },
  secondary: { borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, alignItems: "center", backgroundColor: colors.card },
  secondaryPressed: { backgroundColor: colors.background },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
