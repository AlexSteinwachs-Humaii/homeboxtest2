<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { statCardData } from "./statistics";
  import { itemsTable } from "./table";
  import { useTagStore } from "~/stores/tags";
  import { useLocationStore } from "~~/stores/locations";
  import BaseContainer from "@/components/Base/Container.vue";
  import BaseCard from "@/components/Base/Card.vue";
  import Subtitle from "~/components/global/Subtitle.vue";
  import StatCard from "~/components/global/StatCard/StatCard.vue";
  import ItemCard from "~/components/Item/Card.vue";
  import LocationCard from "~/components/Location/Card.vue";
  import TagChip from "~/components/Tag/Chip.vue";
  import Table from "~/components/Item/View/Table.vue";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { useDialog } from "@/components/ui/dialog-provider";
  import { DialogID } from "@/components/ui/dialog-provider/utils";
  import DateTime from "~/components/global/DateTime.vue";
  import MdiPlus from "~icons/mdi/plus";
  import MdiQrcodeScan from "~icons/mdi/qrcode-scan";
  import MdiMagnify from "~icons/mdi/magnify";
  import MdiClockOutline from "~icons/mdi/clock-outline";
  import { MaintenanceFilterStatus } from "~/lib/api/types/data-contracts";
  import { nextScheduledReminder } from "~/lib/maintenance/reminder";

  const { t } = useI18n();

  definePageMeta({
    middleware: ["auth"],
  });
  useHead({
    title: "HomeBox | " + t("menu.home"),
  });

  const api = useUserApi();
  const breakpoints = useBreakpoints();
  const { openDialog } = useDialog();
  const search = ref("");

  function searchInventory() {
    if (search.value.trim()) {
      navigateTo(`/items?q=${encodeURIComponent(search.value)}`);
    }
  }

  const { data: scheduledTasks } = useAsyncData("home-scheduled-maintenance", async () => {
    const { data } = await api.maintenance.getAll({
      status: MaintenanceFilterStatus.MaintenanceFilterStatusScheduled,
    });
    return data;
  });
  const reminder = computed(() => nextScheduledReminder(scheduledTasks.value ?? []));

  const locationStore = useLocationStore();
  const locations = computed(() => locationStore.parentLocations);

  const tagsStore = useTagStore();
  const tags = computed(() => tagsStore.tags);

  const itemTable = itemsTable(api);
  const stats = statCardData(api);
</script>

<template>
  <div>
    <BaseContainer class="flex flex-col gap-4">
      <section aria-labelledby="overview-heading" class="mb-2 space-y-6" data-testid="overview-lead">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 id="overview-heading" class="text-3xl font-bold tracking-tight">{{ $t("home.overview_heading") }}</h1>
            <p class="mt-2 text-muted-foreground">{{ $t("home.overview_description") }}</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <Button variant="outline" @click="openDialog(DialogID.Scanner)">
              <MdiQrcodeScan />
              {{ $t("menu.scan_label") }}
            </Button>
            <Button @click="openDialog(DialogID.CreateEntity, { params: { baseType: 'item' } })">
              <MdiPlus />
              {{ $t("menu.add_item") }}
            </Button>
          </div>
        </div>
        <form role="search" class="space-y-2" @submit.prevent="searchInventory">
          <label for="overview-search" class="text-sm font-medium">{{ $t("home.search_inventory") }}</label>
          <div class="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <MdiMagnify class="hidden size-5 text-primary sm:block" aria-hidden="true" />
            <Input
              id="overview-search"
              v-model:model-value="search"
              type="search"
              :placeholder="$t('home.search_placeholder')"
              class="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline">{{ $t("home.search_inventory") }}</Button>
          </div>
        </form>
        <div
          v-if="reminder"
          class="flex flex-wrap items-center gap-4 rounded-xl border bg-accent p-5"
          data-testid="care-reminder"
        >
          <MdiClockOutline class="size-6 shrink-0 text-primary" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <h2 class="font-semibold">{{ $t("home.care_heading") }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ reminder.name }} · {{ reminder.itemName }} · {{ $t("home.due") }}
              <DateTime :date="reminder.scheduledDate" format="human" datetime-type="date" />
            </p>
          </div>
          <NuxtLink to="/maintenance" class="font-semibold text-primary hover:underline">
            {{ $t("home.view_maintenance") }} <span aria-hidden="true">→</span>
          </NuxtLink>
        </div>
      </section>

      <section>
        <Subtitle> {{ $t("home.quick_statistics") }} </Subtitle>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-6">
          <StatCard v-for="(stat, i) in stats" :key="i" :title="stat.label" :value="stat.value" :type="stat.type" />
        </div>
      </section>

      <section>
        <Subtitle> {{ $t("home.recently_added") }} </Subtitle>

        <p v-if="itemTable.items.length === 0" class="ml-2 text-sm">{{ $t("items.no_results") }}</p>
        <BaseCard v-else-if="breakpoints.lg">
          <Table :items="itemTable.items" />
        </BaseCard>
        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ItemCard v-for="item in itemTable.items" :key="item.id" :item="item" />
        </div>
      </section>

      <section>
        <Subtitle> {{ $t("home.storage_locations") }} </Subtitle>
        <p v-if="locations.length === 0" class="ml-2 text-sm">{{ $t("locations.no_results") }}</p>
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <LocationCard v-for="location in locations" :key="location.id" :location="location" />
        </div>
      </section>

      <section>
        <Subtitle> {{ $t("home.tags") }} </Subtitle>
        <p v-if="tags.length === 0" class="ml-2 text-sm">{{ $t("tags.no_results") }}</p>
        <div v-else class="flex flex-wrap gap-4">
          <TagChip v-for="tag in tags" :key="tag.id" size="lg" :tag="tag" class="shadow-md" />
        </div>
      </section>
    </BaseContainer>
  </div>
</template>
