import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeboxClient, type EntitySummary, type GroupStatistics, type TagChip } from "../api/client";
import { homebox } from "../theme";
import { Items } from "./inventory-ui";
import { Icon } from "./web-marks";

type Props = {
  client: HomeboxClient;
  groupId: string;
  locations: EntitySummary[];
  loading: boolean;
  refreshKey?: number;
  onOpenItem: (id: string) => void;
  onOpenLocation: (id: string) => void;
  onOpenTags: () => void;
};

function formatMoney(amount: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }
}

const EMPTY_STATS: GroupStatistics = { totalItems: 0, totalLocations: 0, totalTags: 0, totalItemPrice: 0 };

// The website home page: quick statistics, recently added, storage locations, tags.
export function WebHome(props: Props) {
  const [stats, setStats] = useState<GroupStatistics>(EMPTY_STATS);
  const [recent, setRecent] = useState<EntitySummary[]>([]);
  const [tags, setTags] = useState<TagChip[]>([]);
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    let cancelled = false;
    setStats(EMPTY_STATS);
    setRecent([]);
    setTags([]);
    void (async () => {
      const [statistics, items, tagList, collection] = await Promise.all([
        props.client.groupStatistics(),
        props.client.recentItems(),
        props.client.listTags(),
        props.client.getCollection(),
      ]);
      if (cancelled) return;
      if (statistics.ok) setStats(statistics.data);
      if (items.ok) setRecent(items.data);
      if (tagList.ok) setTags(tagList.data.filter((tag) => tag.name.trim() !== ""));
      if (collection.ok && collection.data.currency.trim()) setCurrency(collection.data.currency.trim().toUpperCase());
    })();
    return () => {
      cancelled = true;
    };
  }, [props.client, props.groupId, props.refreshKey]);

  const parents = props.locations.filter((location) => !location.parentId);
  const money = formatMoney(stats.totalItemPrice, currency);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Section title="Quick Statistics">
        <View style={styles.stats}>
          <Stat title="Total Value" value={money} />
          <Stat title="Total Items" value={String(stats.totalItems)} />
          <Stat title="Total Locations" value={String(stats.totalLocations)} />
          <Stat title="Total Tags" value={String(stats.totalTags)} />
        </View>
      </Section>

      <Section title="Recently Added">
        {props.loading ? <Text style={styles.note}>Loading from the server…</Text> : null}
        {!props.loading && recent.length === 0 ? <Text style={styles.note}>No Items Found</Text> : null}
        {recent.length > 0 ? (
          <Items
            items={recent}
            loading={false}
            error={null}
            searchActive={false}
            searching={false}
            onOpenItem={props.onOpenItem}
          />
        ) : null}
      </Section>

      <Section title="Storage Locations">
        {parents.length === 0 ? <Text style={styles.note}>No Locations Found</Text> : null}
        <View style={styles.locationGrid}>
          {parents.map((location) => (
            <Pressable
              key={location.id}
              accessibilityRole="button"
              accessibilityLabel={location.name}
              onPress={() => props.onOpenLocation(location.id)}
              style={styles.locationCard}
            >
              <Icon name="pin" size={18} color={homebox.text} />
              <Text style={styles.locationName} numberOfLines={1}>
                {location.name}
              </Text>
              {location.itemCount > 0 ? <Text style={styles.count}>{location.itemCount}</Text> : <View style={styles.countSpacer} />}
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Tags">
        {tags.length === 0 ? <Text style={styles.note}>No Tags Found</Text> : null}
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Pressable
              key={tag.id}
              accessibilityRole="button"
              accessibilityLabel={tag.name}
              onPress={props.onOpenTags}
              style={[styles.tag, tag.color ? { borderColor: tag.color, backgroundColor: tag.color } : null]}
            >
              <Text style={[styles.tagText, tag.color ? styles.tagTextOnColor : null]}>{tag.name}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 48, gap: 8, maxWidth: 1120, width: "100%", alignSelf: "center" },
  section: { marginBottom: 12 },
  heading: { fontSize: 18, fontWeight: "500", color: homebox.text, marginBottom: 12, paddingLeft: 4 },
  note: { marginLeft: 8, fontSize: 14, color: homebox.muted },
  stats: { flexDirection: "row", gap: 16 },
  stat: {
    flex: 1,
    backgroundColor: homebox.header,
    borderRadius: homebox.radius,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  statTitle: { color: homebox.headerText, fontSize: 14, fontWeight: "500" },
  statValue: { marginTop: 4, color: homebox.headerText, fontSize: 24, fontWeight: "700" },
  locationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  locationCard: {
    width: 220,
    backgroundColor: homebox.card,
    borderRadius: homebox.radius,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  locationName: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: homebox.text },
  count: {
    minWidth: 22,
    textAlign: "center",
    backgroundColor: homebox.primary,
    color: homebox.primaryText,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  countSpacer: { width: 22 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tag: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: homebox.border,
    backgroundColor: homebox.card,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  tagText: { fontSize: 16, color: homebox.text, fontWeight: "500" },
  tagTextOnColor: { color: "#1c2822" },
});
