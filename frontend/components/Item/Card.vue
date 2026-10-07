<template>
  <Card class="relative overflow-hidden rounded-2xl border shadow-none" data-testid="item-card">
    <div v-if="tableRow" class="absolute left-1 top-1 z-10">
      <Checkbox
        class="size-5 bg-accent hover:bg-background-accent"
        :model-value="tableRow.getIsSelected()"
        :aria-label="$t('components.item.view.selectable.select_card')"
        @update:model-value="tableRow.toggleSelected()"
      />
    </div>
    <NuxtLink
      class="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      :to="`/item/${item.id}`"
    >
      <div class="relative h-[200px] overflow-hidden bg-muted lg:h-[120px]">
        <img
          v-if="imageUrl && objectContain"
          class="absolute size-full object-cover blur-md"
          loading="lazy"
          :src="imageUrl"
          alt=""
        />
        <img
          v-if="imageUrl"
          class="absolute size-full"
          :class="objectContain ? 'object-contain' : 'object-cover'"
          loading="lazy"
          :src="imageUrl"
          :alt="item.name"
        />
      </div>
      <div class="flex flex-col gap-y-1 p-4">
        <h2 class="line-clamp-2 text-ellipsis text-wrap text-lg font-bold">
          {{ item.name }}
        </h2>
        <p class="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          <span :aria-label="$t('items.asset_id')">{{ item.assetId }}</span>
          <template v-if="locationString"
            ><span aria-hidden="true">·</span><span>{{ locationString }}</span></template
          >
          <span aria-hidden="true">·</span>
          <span>{{ $t("global.quantity") }} {{ item.quantity }}</span>
          <template v-if="Number(item.purchasePrice)">
            <span aria-hidden="true">·</span>
            <span :aria-label="$t('items.purchase_price')"><Currency :amount="item.purchasePrice" /></span>
          </template>
        </p>
        <TooltipProvider v-if="item.insured || item.archived" :delay-duration="0">
          <div class="flex items-center gap-2">
            <Tooltip v-if="item.insured">
              <TooltipTrigger>
                <MdiShieldCheck class="size-5 text-primary" />
              </TooltipTrigger>
              <TooltipContent>
                {{ $t("global.insured") }}
              </TooltipContent>
            </Tooltip>
            <Tooltip v-if="item.archived">
              <TooltipTrigger>
                <MdiArchive class="size-5 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>
                {{ $t("global.archived") }}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </NuxtLink>
    <div v-if="itemTags.length" class="flex flex-wrap justify-end gap-2 px-4 pb-4">
      <TagChip v-for="tag in itemTags" :key="tag.id" :tag="tag" size="sm" :ancestors="tag.ancestors" />
    </div>
  </Card>
</template>

<script setup lang="ts">
  import type { EntityOut, EntitySummary } from "~~/lib/api/types/data-contracts";
  import MdiShieldCheck from "~icons/mdi/shield-check";
  import MdiArchive from "~icons/mdi/archive";
  import { Card } from "@/components/ui/card";
  import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
  import Currency from "@/components/global/Currency.vue";
  import TagChip from "@/components/Tag/Chip.vue";
  import type { Row } from "@tanstack/vue-table";
  import { Checkbox } from "@/components/ui/checkbox";

  const api = useUserApi();
  const preferences = useViewPreferences();

  const imageUrl = computed(() => {
    if (!props.item.imageId) {
      return "/no-image.jpg";
    }
    if (props.item.thumbnailId) {
      return api.authURL(`/entities/${props.item.id}/attachments/${props.item.thumbnailId}`);
    } else {
      return api.authURL(`/entities/${props.item.id}/attachments/${props.item.imageId}`);
    }
  });

  const itemTags = computed(() => {
    return useTagStore().withAncestors(props.item.tags);
  });

  const props = defineProps({
    item: {
      type: Object as () => EntityOut | EntitySummary,
      required: true,
    },
    locationFlatTree: {
      type: Array as () => FlatTreeItem[],
      required: false,
      default: () => [],
    },
    tableRow: {
      type: Object as () => Row<EntitySummary>,
      required: false,
      default: () => null,
    },
  });

  const objectContain = computed(() => imageUrl.value !== "/no-image.jpg" && !preferences.value.legacyImageFit);

  const locationString = computed(
    () => props.locationFlatTree.find(l => l.id === props.item.parent?.id)?.treeString || props.item.parent?.name
  );
</script>

<style lang="css"></style>
