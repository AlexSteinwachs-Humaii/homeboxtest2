import { createElement, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { defaultWebServerUrl } from "../api/client";
import { colors, homebox } from "../theme";
import { HouseMark } from "./web-marks";

export type SignInForm = {
  serverUrl: string;
  username: string;
  password: string;
  stayLoggedIn: boolean;
};

type Props = {
  initialServerUrl: string;
  error: string | null;
  busy: boolean;
  onSubmit: (form: SignInForm) => void;
};

export function SignInScreen({ initialServerUrl, error, busy, onSubmit }: Props) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(true);

  // The website is served by the HomeBox it talks to, so the address is the
  // page origin. The phone still has to name a remote server.
  const showServerAddress = Platform.OS !== "web";
  const submittedServerUrl = showServerAddress ? serverUrl : initialServerUrl || defaultWebServerUrl();

  const serverField = showServerAddress ? (
    <Field
      label="Server address"
      value={serverUrl}
      onChangeText={setServerUrl}
      placeholder="http://192.168.1.20:7745"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      textContentType="URL"
      editable={!busy}
      hint="Include https:// if your server uses it. Otherwise http:// is assumed."
    />
  ) : null;

  const form = (
    <>
      {serverField}
      <Field
        label="Email"
        value={username}
        onChangeText={setUsername}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        textContentType="password"
        editable={!busy}
      />
      <View style={styles.remember}>
        <View style={styles.rememberCopy}>
          <Text style={styles.rememberTitle}>Stay signed in</Text>
          <Text style={styles.hint}>Keeps the session for longer. The inventory still lives on the server.</Text>
        </View>
        <Switch
          value={stayLoggedIn}
          onValueChange={setStayLoggedIn}
          disabled={busy}
          trackColor={{ true: colors.mark, false: colors.line }}
          accessibilityLabel="Stay signed in"
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => onSubmit({ serverUrl: submittedServerUrl, username, password, stayLoggedIn })}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonBusy]}
      >
        <Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
    </>
  );

  if (Platform.OS === "web") {
    return (
      <ScrollView style={styles.webPage} contentContainerStyle={styles.webContent}>
        <View style={styles.waveBand}>
          <View style={styles.waveFill} />
          <Wave />
        </View>
        <View style={styles.webHeader}>
          <View style={styles.webTitleRow}>
            <Text style={styles.webTitle}>HomeB</Text>
            <HouseMark width={48} height={44} label="" />
            <Text style={styles.webTitle}>x</Text>
          </View>
          <Text style={styles.webTagline}>Track, Organize, and Manage your Things.</Text>
        </View>
        <View style={styles.webCard}>
          <Text style={styles.webCardTitle}>Login</Text>
          {form}
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.mark}>
            <Text style={styles.markText}>HB</Text>
          </View>
          <Text style={styles.title}>HomeBox</Text>
          <Text style={styles.subtitle}>Sign in to the server that already holds your inventory.</Text>

          <View style={styles.card}>{form}</View>

          <Text style={styles.footer}>
            This phone does not keep a copy of the inventory. Closing the app and opening it again asks the server who you are.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences";
  autoCorrect?: boolean;
  keyboardType?: "default" | "url" | "email-address";
  textContentType?: "URL" | "username" | "password";
  secureTextEntry?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={colors.muted}
        style={styles.input}
        accessibilityLabel={label}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Wave() {
  return createElement(
    "svg",
    {
      viewBox: "0 0 1440 320",
      preserveAspectRatio: "none",
      style: { width: "100%", height: 120, display: "block" },
    },
    createElement("path", {
      fill: homebox.primary,
      d: "M0,32L80,69.3C160,107,320,181,480,181.3C640,181,800,107,960,117.3C1120,128,1280,224,1360,272L1440,320L1440,0L1360,0C1280,0,1120,0,960,0C800,0,640,0,480,0C320,0,160,0,80,0L0,0Z",
    }),
  );
}

const styles = StyleSheet.create({
  webPage: { flex: 1, backgroundColor: "#ffffff" },
  webContent: { paddingBottom: 48 },
  waveBand: { position: "absolute", top: 0, left: 0, right: 0 },
  waveFill: { height: 180, backgroundColor: homebox.primary },
  webHeader: { paddingHorizontal: 48, paddingTop: 36, zIndex: 1 },
  webTitleRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  webTitle: { fontSize: 56, fontWeight: "700", color: homebox.accent, letterSpacing: -1 },
  webLogo: { fontSize: 42, color: homebox.accent },
  webTagline: { marginTop: 4, marginLeft: 4, fontSize: 18, color: homebox.accent },
  webCard: {
    marginTop: 48,
    marginHorizontal: 24,
    alignSelf: "center",
    width: "100%",
    maxWidth: 500,
    backgroundColor: "#ffffff",
    borderRadius: homebox.radius,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 1,
  },
  webCardTitle: { fontSize: 22, fontWeight: "600", color: homebox.text, marginBottom: 12 },
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40, maxWidth: 520, width: "100%", alignSelf: "center" },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.mark,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  markText: { color: colors.onPrimary, fontSize: 20, fontWeight: "700", letterSpacing: 0.5 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, letterSpacing: -0.5 },
  subtitle: { marginTop: 8, fontSize: 16, lineHeight: 22, color: colors.muted },
  card: {
    marginTop: 24,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
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
  hint: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.muted },
  remember: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  rememberCopy: { flex: 1 },
  rememberTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  error: {
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  buttonPressed: { backgroundColor: colors.primaryPressed },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  footer: { marginTop: 18, fontSize: 13, lineHeight: 19, color: colors.muted },
});
