import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { homebox } from "../theme";
import { HouseMark, Icon, Wordmark } from "./web-marks";

export type WebNav = "home" | "items" | "locations" | "tags" | "templates" | "maintenance" | "profile" | "tools" | "scan";

type NavItem = { id: WebNav; label: string; aria: string; icon: string };

// Same destinations as the website sidebar. Search is the items page.
// Collection is the website's cog menu; the phone and the browser test still
// call that control Tools.
const NAV: NavItem[] = [
  { id: "home", label: "Home", aria: "Home", icon: "home" },
  { id: "locations", label: "Locations", aria: "Locations", icon: "locations" },
  { id: "tags", label: "Tags", aria: "Tags", icon: "tags" },
  { id: "items", label: "Search", aria: "Search", icon: "search" },
  { id: "templates", label: "Templates", aria: "Templates", icon: "templates" },
  { id: "maintenance", label: "Maintenance", aria: "Maintenance", icon: "maintenance" },
  { id: "profile", label: "Profile", aria: "Profile", icon: "profile" },
  { id: "tools", label: "Collection", aria: "Tools", icon: "tools" },
];

type Props = {
  accountName: string;
  active: WebNav;
  onNavigate: (nav: WebNav) => void;
  onCreateItem: () => void;
  onCreateLocation: () => void;
  onCreateTag: () => void;
  onSignOut: () => void;
  collections: ReactNode;
  search?: ReactNode;
  children: ReactNode;
};

// Desktop chrome for the browser client. It follows the Go app's website:
// gray sidebar, house mark, sage Create menu, dark header, gray canvas.
// The phone layout is unchanged. This does not import the Nuxt app.
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 800);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setNarrow(window.innerWidth < 800);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return narrow;
}

export function WebShell(props: Props) {
  const welcome = props.accountName.trim() || "there";
  const [menu, setMenu] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const narrow = useNarrow();
  const go = (nav: WebNav) => {
    setNavOpen(false);
    props.onNavigate(nav);
  };
  return (
    <View style={styles.root}>
      {narrow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={navOpen ? "Close navigation" : "Open navigation"}
          onPress={() => setNavOpen((open) => !open)}
          style={styles.navToggle}
        >
          <Text style={styles.navToggleText}>{navOpen ? "Close" : "Menu"}</Text>
        </Pressable>
      ) : null}
      {narrow && navOpen ? <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => setNavOpen(false)} style={styles.backdrop} /> : null}
      <View style={[styles.sidebar, narrow && styles.sidebarNarrow, narrow && !navOpen && styles.sidebarHidden]}>
        <Text style={styles.welcome} numberOfLines={1}>
          Welcome, {welcome}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Home" onPress={() => go("home")} style={styles.logoButton}>
          <View style={styles.logo}>
            <HouseMark width={62} height={56} />
          </View>
        </Pressable>
        {props.collections}
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New item"
            onPress={() => {
              setMenu(false);
              props.onCreateItem();
            }}
            style={({ pressed }) => [styles.create, pressed && styles.createPressed]}
          >
            <Icon name="plus" size={18} color={homebox.primaryText} />
            <Text style={styles.createText}>Create</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create menu"
            onPress={() => setMenu((open) => !open)}
            style={styles.createChevron}
          >
            <Icon name="chevron" size={18} color={homebox.primaryText} />
          </Pressable>
          {menu ? (
            <View style={styles.menu}>
              <MenuRow label="Item / Asset" onPress={() => { setMenu(false); props.onCreateItem(); }} />
              <MenuRow label="Location" onPress={() => { setMenu(false); props.onCreateLocation(); }} />
              <MenuRow label="Tag" onPress={() => { setMenu(false); props.onCreateTag(); }} />
            </View>
          ) : null}
        </View>
        <ScrollView style={styles.navScroll} contentContainerStyle={styles.nav}>
          {NAV.map((item) => {
            const selected = props.active === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.aria}
                accessibilityState={{ selected }}
                onPress={() => go(item.id)}
                style={[styles.navItem, selected && styles.navItemSelected]}
              >
                <Icon name={item.icon} size={18} color={selected ? homebox.accentText : homebox.sidebarText} />
                <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={props.onSignOut} style={styles.signOut}>
          <Icon name="logout" size={18} color={homebox.sidebarText} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.main}>
        <View style={[styles.header, narrow && styles.headerNarrow]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Home" onPress={() => go("home")} style={styles.wordmarkButton}>
            <Wordmark />
          </Pressable>
          <View style={styles.headerSpacer} />
          <View style={styles.headerSearch}>{props.search}</View>
        </View>
        <View style={styles.content}>{props.children}</View>
        <Text style={styles.footer}>Version: nightly Build: HEAD ~ API</Text>
      </View>
    </View>
  );
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.menuRow}>
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: homebox.canvas, minHeight: "100%", width: "100%", maxWidth: "100%", overflow: "hidden" },
  navToggle: {
    position: "absolute",
    top: 14,
    left: 8,
    zIndex: 6,
    backgroundColor: homebox.header,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  navToggleText: { color: homebox.headerText, fontSize: 14, fontWeight: "600" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)", zIndex: 3 },
  sidebar: {
    width: 256,
    backgroundColor: homebox.sidebar,
    paddingTop: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  sidebarNarrow: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 4 },
  sidebarHidden: { display: "none" },
  welcome: { textAlign: "center", fontSize: 16, color: homebox.sidebarText, marginBottom: 8 },
  logoButton: { alignItems: "center", marginBottom: 12 },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: homebox.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  create: {
    marginTop: 8,
    marginHorizontal: 4,
    backgroundColor: homebox.primary,
    borderRadius: homebox.radius,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  createPressed: { backgroundColor: "#4a6854" },
  createText: { color: homebox.primaryText, fontSize: 16, fontWeight: "600" },
  createChevron: {
    position: "absolute",
    right: 8,
    top: 14,
    width: 32,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    marginTop: 4,
    marginHorizontal: 4,
    backgroundColor: homebox.card,
    borderRadius: homebox.radius,
    borderWidth: 1,
    borderColor: homebox.border,
    overflow: "hidden",
    zIndex: 5,
  },
  menuRow: { paddingHorizontal: 12, paddingVertical: 10 },
  menuText: { fontSize: 16, color: homebox.text },
  navScroll: { flex: 1, marginTop: 8 },
  nav: { paddingBottom: 8, gap: 2 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: homebox.radius, paddingHorizontal: 10, paddingVertical: 8 },
  navItemSelected: { backgroundColor: homebox.accent },
  navLabel: { fontSize: 14, color: homebox.sidebarText },
  navLabelSelected: { color: homebox.accentText, fontWeight: "600" },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  signOutText: { color: homebox.sidebarText, fontSize: 14, fontWeight: "600" },
  main: { flex: 1, minWidth: 0, maxWidth: "100%" },
  header: {
    height: 64,
    backgroundColor: homebox.header,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 2,
  },
  headerNarrow: { paddingLeft: 72 },
  wordmarkButton: { paddingHorizontal: 4, flexShrink: 1 },
  headerSpacer: { flex: 1 },
  headerSearch: { flex: 1, minWidth: 0, maxWidth: 420, alignItems: "flex-end" },
  content: { flex: 1, backgroundColor: homebox.canvas },
  footer: { textAlign: "center", color: homebox.muted, fontSize: 13, paddingBottom: 12, backgroundColor: homebox.canvas },
});
