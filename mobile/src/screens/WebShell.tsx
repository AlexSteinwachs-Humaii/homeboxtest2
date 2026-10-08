import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { homebox } from "../theme";

export type WebNav = "home" | "items" | "locations" | "tags" | "templates" | "maintenance" | "profile" | "tools" | "scan";

type NavItem = { id: WebNav; label: string; mark: string };

// Same destinations as the website sidebar. "Search" is the items page.
const NAV: NavItem[] = [
  { id: "home", label: "Home", mark: "⌂" },
  { id: "locations", label: "Locations", mark: "▦" },
  { id: "tags", label: "Tags", mark: "#" },
  { id: "items", label: "Search", mark: "⌕" },
  { id: "templates", label: "Templates", mark: "▤" },
  { id: "maintenance", label: "Maintenance", mark: "⚒" },
  { id: "profile", label: "Profile", mark: "☺" },
  { id: "tools", label: "Tools", mark: "⚙" },
];

type Props = {
  accountName: string;
  active: WebNav;
  onNavigate: (nav: WebNav) => void;
  onCreateItem: () => void;
  onCreateLocation: () => void;
  onSignOut: () => void;
  collections: ReactNode;
  search?: ReactNode;
  children: ReactNode;
};

// Desktop chrome for the browser client. It follows the Go app's website layout:
// gray sidebar, sage Create button, dark secondary header, gray canvas.
// The phone layout is unchanged. This does not import the Nuxt app.
export function WebShell(props: Props) {
  const welcome = props.accountName.trim() || "there";
  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
        <Text style={styles.welcome} numberOfLines={1}>
          Welcome, {welcome}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Home" onPress={() => props.onNavigate("home")} style={styles.logoButton}>
          <View style={styles.logo}>
            <Text style={styles.logoMark}>HB</Text>
          </View>
        </Pressable>
        {props.collections}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New item"
          onPress={props.onCreateItem}
          style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
        >
          <Text style={styles.createText}>+  New item</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onCreateLocation} style={styles.locationCreate}>
          <Text style={styles.locationCreateText}>New location</Text>
        </Pressable>
        <ScrollView style={styles.navScroll} contentContainerStyle={styles.nav}>
          {NAV.map((item) => {
            const selected = props.active === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => props.onNavigate(item.id)}
                style={[styles.navItem, selected && styles.navItemSelected]}
              >
                <Text style={[styles.navMark, selected && styles.navLabelSelected]}>{item.mark}</Text>
                <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={props.onSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.main}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>HomeBox</Text>
          <View style={styles.headerSearch}>{props.search}</View>
        </View>
        <View style={styles.content}>{props.children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: homebox.canvas, minHeight: "100%" },
  sidebar: {
    width: 256,
    backgroundColor: homebox.sidebar,
    borderRightWidth: 1,
    borderRightColor: homebox.border,
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  welcome: { textAlign: "center", fontSize: 16, color: homebox.sidebarText, marginBottom: 12 },
  logoButton: { alignItems: "center", marginBottom: 12 },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: homebox.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMark: { fontSize: 28, fontWeight: "700", color: homebox.primary, letterSpacing: 0.5 },
  create: {
    marginTop: 12,
    backgroundColor: homebox.primary,
    borderRadius: homebox.radius,
    paddingVertical: 10,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  createPressed: { backgroundColor: "#4a6854" },
  createText: { color: homebox.primaryText, fontSize: 16, fontWeight: "600" },
  locationCreate: { alignItems: "center", paddingVertical: 8 },
  locationCreateText: { color: homebox.primary, fontSize: 14, fontWeight: "600" },
  navScroll: { flex: 1, marginTop: 4 },
  nav: { paddingBottom: 12, gap: 2 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: homebox.radius, paddingHorizontal: 10, paddingVertical: 10 },
  navItemSelected: { backgroundColor: homebox.canvas },
  navMark: { width: 18, textAlign: "center", color: homebox.sidebarText, fontSize: 16 },
  navLabel: { fontSize: 15, color: homebox.sidebarText },
  navLabelSelected: { color: homebox.text, fontWeight: "600" },
  signOut: { paddingVertical: 12, alignItems: "center" },
  signOutText: { color: homebox.sidebarText, fontSize: 15, fontWeight: "600" },
  main: { flex: 1, minWidth: 0 },
  header: {
    height: 64,
    backgroundColor: homebox.header,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  wordmark: { color: homebox.headerText, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  headerSearch: { flex: 1, alignItems: "flex-end" },
  content: { flex: 1, backgroundColor: homebox.canvas },
});
