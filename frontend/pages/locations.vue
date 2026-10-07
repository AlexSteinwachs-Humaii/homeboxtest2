<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import MdiMapMarkerOutline from "~icons/mdi/map-marker-outline";
  import MdiMagnify from "~icons/mdi/magnify";
  import MdiPlus from "~icons/mdi/plus";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import BaseContainer from "@/components/Base/Container.vue";
  import { useDialog } from "~/components/ui/dialog-provider";
  import { DialogID } from "~/components/ui/dialog-provider/utils";
  import { locationCards } from "~/lib/locations/cards";

  const { t } = useI18n();
  const { openDialog } = useDialog();
  const locationStore = useLocationStore();
  const search = ref("");

  definePageMeta({ middleware: ["auth"] });
  useHead({ title: "HomeBox | " + t("menu.locations") });

  // The tree marks location nodes explicitly, so item names never become nested-place summaries.
  // Refresh both sources on entry, including after creating a location or switching collections.
  const { pending, error } = useAsyncData(async () => {
    const results = await Promise.all([locationStore.refreshParents(), locationStore.refreshTree()]);
    if (results.some(result => result.error)) {
      throw new Error(t("locations.toast.failed_load_location"));
    }
    return true;
  });

  const cards = computed(() => locationCards(locationStore.parentLocations, locationStore.tree ?? [], search.value));
</script>

<template>
  <BaseContainer class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">{{ $t("menu.locations") }}</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          {{
            $t("locations.places_summary", {
              count: locationStore.parentLocations.length,
            })
          }}
        </p>
      </div>
      <Button
        type="button"
        @click="
          openDialog(DialogID.CreateEntity, {
            params: { baseType: 'location' },
          })
        "
      >
        <MdiPlus aria-hidden="true" />
        {{ $t("locations.add_location") }}
      </Button>
    </header>

    <div role="search" class="relative">
      <label for="location-search" class="sr-only">{{ $t("locations.find_location") }}</label>
      <MdiMagnify class="pointer-events-none absolute left-4 top-4 size-4 text-primary" aria-hidden="true" />
      <Input
        id="location-search"
        v-model:model-value="search"
        type="search"
        :placeholder="$t('locations.find_location')"
        class="h-12 bg-card pl-11"
      />
    </div>

    <p v-if="pending" role="status" class="text-sm text-muted-foreground">
      {{ $t("global.loading") }}
    </p>
    <p v-else-if="error" role="alert" class="text-sm text-destructive">
      {{ $t("locations.toast.failed_load_location") }}
    </p>
    <p v-else-if="cards.length === 0" role="status" class="text-sm text-muted-foreground">
      {{ $t("locations.no_results") }}
    </p>
    <ul v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" :aria-label="$t('menu.locations')">
      <li v-for="card in cards" :key="card.location.id" data-testid="location-card">
        <NuxtLink
          :to="`/location/${card.location.id}`"
          class="flex h-full flex-col rounded-2xl border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span class="mb-4 flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
            <MdiMapMarkerOutline aria-hidden="true" />
          </span>
          <h2 class="break-words text-lg font-semibold">
            {{ card.location.name }}
          </h2>
          <!-- The API count is direct item quantity, not a recursive count of nested contents. -->
          <p class="mb-3 mt-1 text-sm text-muted-foreground">
            {{
              $t("locations.item_count", {
                count: card.location.itemCount ?? 0,
              })
            }}
          </p>
          <p class="mt-auto border-t pt-3 text-xs text-muted-foreground">
            {{
              card.nestedNames.length
                ? $t("locations.nested_summary", {
                    count: card.nestedNames.length,
                    names: card.nestedNames.join(", "),
                  })
                : $t("locations.no_nested_locations")
            }}
          </p>
        </NuxtLink>
      </li>
    </ul>
  </BaseContainer>
</template>
