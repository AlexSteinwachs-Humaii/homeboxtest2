<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { statCardData } from "./statistics";
  import { itemsTable } from "./table";
  import { useLocationStore } from "~~/stores/locations";
  import BaseContainer from "@/components/Base/Container.vue";
  import Currency from "~/components/global/Currency.vue";
  import type { EntitySummary } from "~/lib/api/types/data-contracts";
  import MdiMapMarkerOutline from "~icons/mdi/map-marker-outline";
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
  const locations = computed(() => locationStore.parentLocations.slice(0, 3));

  function itemImage(item: EntitySummary) {
    const attachmentId = item.thumbnailId || item.imageId;
    return attachmentId ? api.authURL(`/entities/${item.id}/attachments/${attachmentId}`) : "/no-image.jpg";
  }

  const itemTable = itemsTable(api);
  const stats = statCardData(api);
</script>

<template>
  <div>
    <BaseContainer class="flex flex-col gap-4">
      <section aria-labelledby="overview-heading" class="mb-2 space-y-6" data-testid="overview-lead">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 id="overview-heading" class="text-3xl font-bold tracking-tight">
              {{ $t("home.overview_heading") }}
            </h1>
            <p class="mt-2 text-muted-foreground">
              {{ $t("home.overview_description") }}
            </p>
          </div>
          <div class="flex flex-wrap gap-3">
            <Button variant="outline" @click="openDialog(DialogID.Scanner)">
              <MdiQrcodeScan />
              {{ $t("menu.scan_label") }}
            </Button>
            <Button @click="navigateTo('/item/new')">
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
              {{ reminder.name }} · {{ reminder.itemName }} ·
              {{ $t("home.due") }}
              <DateTime :date="reminder.scheduledDate" format="human" datetime-type="date" />
            </p>
          </div>
          <NuxtLink to="/maintenance" class="font-semibold text-primary hover:underline">
            {{ $t("home.view_maintenance") }} <span aria-hidden="true">→</span>
          </NuxtLink>
        </div>
      </section>

      <div class="grid items-start gap-8 lg:grid-cols-5">
        <section aria-labelledby="recent-items-heading" class="lg:col-span-3" data-testid="recent-items">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 id="recent-items-heading" class="text-xl font-semibold">
              {{ $t("home.recently_added") }}
            </h2>
            <NuxtLink to="/items" class="font-semibold text-primary hover:underline">
              {{ $t("home.all_items") }} <span aria-hidden="true">→</span>
            </NuxtLink>
          </div>
          <p v-if="itemTable.items.length === 0" class="ml-2 text-sm">
            {{ $t("items.no_results") }}
          </p>
          <ul v-else class="divide-y rounded-xl border bg-card px-5">
            <li v-for="item in itemTable.items" :key="item.id">
              <NuxtLink :to="`/item/${item.id}`" class="flex items-center gap-4 py-5 hover:text-primary">
                <img
                  :src="itemImage(item)"
                  :alt="item.name"
                  loading="lazy"
                  class="size-20 shrink-0 rounded-xl bg-muted object-cover"
                  @error="($event.target as HTMLImageElement).src = '/no-image.jpg'"
                />
                <div class="min-w-0 flex-1">
                  <h3 class="break-words font-semibold">{{ item.name }}</h3>
                  <p class="mt-1 text-sm text-muted-foreground">
                    {{ [item.parent?.name, `${$t("global.quantity")} ${item.quantity}`].filter(Boolean).join(" · ") }}
                  </p>
                </div>
                <span aria-hidden="true">›</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <section aria-labelledby="locations-heading" class="lg:col-span-2" data-testid="location-shortcuts">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 id="locations-heading" class="text-xl font-semibold">
              {{ $t("home.browse_locations") }}
            </h2>
            <NuxtLink to="/locations" class="font-semibold text-primary hover:underline">
              {{ $t("home.all_locations") }} <span aria-hidden="true">→</span>
            </NuxtLink>
          </div>
          <p v-if="locations.length === 0" class="ml-2 text-sm">
            {{ $t("locations.no_results") }}
          </p>
          <ul v-else class="divide-y rounded-xl border bg-card px-5">
            <li v-for="location in locations" :key="location.id">
              <NuxtLink :to="`/location/${location.id}`" class="flex items-center gap-3 py-5 hover:text-primary">
                <MdiMapMarkerOutline class="size-5 shrink-0 text-primary" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <h3 class="break-words font-semibold">{{ location.name }}</h3>
                  <!-- Location listings omit itemCount when it is zero. -->
                  <p class="mt-1 text-sm text-muted-foreground">{{ location.itemCount ?? 0 }} {{ $t("menu.items") }}</p>
                </div>
                <span aria-hidden="true">›</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>

      <section :aria-label="$t('home.inventory_summary')" class="mt-4 border-t pt-6" data-testid="purchase-summary">
        <dl class="flex flex-wrap gap-x-10 gap-y-4">
          <div v-for="stat in stats" :key="stat.label" class="flex flex-col-reverse gap-1">
            <dt class="text-sm text-muted-foreground">{{ stat.label }}</dt>
            <dd class="text-2xl font-bold">
              <Currency v-if="stat.type === 'currency'" :amount="stat.value" />
              <template v-else>{{ stat.value }}</template>
            </dd>
          </div>
        </dl>
        <p class="mt-3 text-sm text-muted-foreground">
          {{ $t("home.purchase_summary_note") }}
        </p>
      </section>
    </BaseContainer>
  </div>
</template>
