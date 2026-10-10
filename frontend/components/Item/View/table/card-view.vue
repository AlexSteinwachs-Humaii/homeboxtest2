<script setup lang="ts">
  import ItemCard from "@/components/Item/Card.vue";
  import type { EntitySummary } from "~/lib/api/types/data-contracts";
  import type { Table as TableType } from "@tanstack/vue-table";
  import MdiSelectSearch from "~icons/mdi/select-search";
  import { Checkbox } from "@/components/ui/checkbox";
  import { Button } from "@/components/ui/button";
  import DropdownAction from "./data-table-dropdown.vue";

  const preferences = useViewPreferences();

  const props = defineProps<{
    table: TableType<EntitySummary>;
    locationFlatTree?: FlatTreeItem[];
  }>();

  defineEmits<{
    (e: "refresh"): void;
  }>();

  const selectedCount = computed(() => props.table.getSelectedRowModel().rows.length);
</script>

<template>
  <Teleport to="#selectable-subtitle" defer>
    <Checkbox
      class="size-6 p-0"
      :model-value="
        table.getIsAllPageRowsSelected() ? true : table.getSelectedRowModel().rows.length > 0 ? 'indeterminate' : false
      "
      :aria-label="$t('components.item.view.selectable.select_all')"
      @update:model-value="table.toggleAllPageRowsSelected(!!$event)"
    />

    <span v-if="selectedCount > 0" class="ml-2 text-sm" role="status">
      {{ $t("components.item.view.selectable.selected_count", { count: selectedCount }) }}
    </span>
    <div class="grow" />

    <div v-if="selectedCount > 0" class="inline-flex items-center gap-2">
      <Button variant="ghost" size="sm" @click="table.resetRowSelection()">
        {{ $t("components.item.view.selectable.clear_selection") }}
      </Button>
      <DropdownAction
        direct-move
        :multi="{ items: table.getSelectedRowModel().rows, columns: table.getAllColumns() }"
        view="card"
        :table="table"
        @refresh="$emit('refresh')"
      />
      <DropdownAction
        :multi="{ items: table.getSelectedRowModel().rows, columns: table.getAllColumns() }"
        view="card"
        :table="table"
        @refresh="$emit('refresh')"
      />
    </div>
  </Teleport>
  <div v-if="table.getRowModel().rows?.length === 0" class="flex flex-col items-center gap-2">
    <MdiSelectSearch class="size-10" />
    <p>{{ $t("items.no_results") }}</p>
  </div>
  <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
    <ItemCard
      v-for="item in table.getRowModel().rows"
      :key="item.original.id"
      :item="item.original"
      :table-row="preferences.quickActions.enabled ? item : undefined"
      :location-flat-tree="locationFlatTree"
    />
  </div>
</template>
