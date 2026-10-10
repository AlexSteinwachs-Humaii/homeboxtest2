<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import type { MaintenanceEntry, MaintenanceEntryWithDetails } from "~~/lib/api/types/data-contracts";
  import { MaintenanceFilterStatus } from "~~/lib/api/types/data-contracts";
  import MdiCheck from "~icons/mdi/check";
  import MdiDelete from "~icons/mdi/delete";
  import MdiEdit from "~icons/mdi/edit";
  import MdiCalendar from "~icons/mdi/calendar";
  import MdiPlus from "~icons/mdi/plus";
  import MdiWrenchClock from "~icons/mdi/wrench-clock";
  import MdiContentDuplicate from "~icons/mdi/content-duplicate";
  import MaintenanceEditModal from "~~/components/Maintenance/EditModal.vue";
  import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
  import { Badge } from "@/components/ui/badge";
  import { Button, ButtonGroup } from "@/components/ui/button";
  import BaseSectionHeader from "@/components/Base/SectionHeader.vue";
  import DateTime from "~/components/global/DateTime.vue";
  import Currency from "~/components/global/Currency.vue";
  import Markdown from "~/components/global/Markdown.vue";
  import { toast } from "@/components/ui/sonner";
  import { useDialog } from "@/components/ui/dialog-provider";
  import { toDateOnlyString } from "~/lib/datelib/dateOnly";
  import { DialogID } from "../ui/dialog-provider/utils";

  import { countOverdue, partitionMaintenance } from "~/lib/maintenance/list";

  const maintenanceFilterStatus = ref(MaintenanceFilterStatus.MaintenanceFilterStatusBoth);

  const api = useUserApi();
  const { t } = useI18n();
  const confirm = useConfirm();
  const { openDialog } = useDialog();

  const props = defineProps({
    currentItemId: {
      type: String,
      default: undefined,
    },
  });

  const {
    data: maintenanceDataList,
    status,
    refresh: refreshList,
  } = useAsyncData(
    async () => {
      const { data, error } =
        props.currentItemId !== undefined
          ? await api.items.maintenance.getLog(props.currentItemId, {
              status: MaintenanceFilterStatus.MaintenanceFilterStatusBoth,
            })
          : await api.maintenance.getAll({
              status: MaintenanceFilterStatus.MaintenanceFilterStatusBoth,
            });
      if (error) throw error;
      return data ?? [];
    },
    { watch: [() => props.currentItemId] }
  );

  const loadState = computed(() => status.value);
  const hasEntries = computed(() => (maintenanceDataList.value?.length ?? 0) > 0);
  const entries = computed(() => partitionMaintenance(maintenanceDataList.value ?? []));
  const overdueCount = computed(() => countOverdue(entries.value.scheduled));
  const sections = computed(() => {
    const result = [];
    if (maintenanceFilterStatus.value !== MaintenanceFilterStatus.MaintenanceFilterStatusCompleted) {
      result.push({ key: "scheduled", entries: entries.value.scheduled });
    }
    if (maintenanceFilterStatus.value !== MaintenanceFilterStatus.MaintenanceFilterStatusScheduled) {
      result.push({ key: "completed", entries: entries.value.completed });
    }
    return result;
  });

  async function deleteEntry(id: string) {
    const result = await confirm.open(t("maintenance.modal.delete_confirmation"));
    if (result.isCanceled) {
      return;
    }

    const { error } = await api.maintenance.delete(id);

    if (error) {
      toast.error(t("maintenance.toast.failed_to_delete"));
      return;
    }
    refreshList();
  }

  async function completeEntry(maintenanceEntry: MaintenanceEntry) {
    const { error } = await api.maintenance.update(maintenanceEntry.id, {
      name: maintenanceEntry.name,
      // Local YYYY-MM-DD — using a Date object would JSON-stringify to UTC and
      // shift the day for users east of UTC.
      completedDate: toDateOnlyString(new Date()),
      scheduledDate: (maintenanceEntry.scheduledDate as string) ?? "",
      description: maintenanceEntry.description,
      cost: maintenanceEntry.cost,
    });
    if (error) {
      toast.error(t("maintenance.toast.failed_to_update"));
    }
    refreshList();
  }
</script>

<template>
  <section class="space-y-6">
    <p v-if="loadState === 'success'" class="text-sm text-muted-foreground" role="status">
      {{ $t("maintenance.summary.scheduled", { count: entries.scheduled.length }) }}
      ·
      {{
        overdueCount
          ? $t("maintenance.summary.overdue", { count: overdueCount })
          : $t("maintenance.summary.none_overdue")
      }}
    </p>
    <p v-else-if="loadState === 'pending'" role="status">
      {{ $t("maintenance.summary.loading") }}
    </p>
    <p v-else-if="loadState === 'error'" role="alert">
      {{ $t("maintenance.summary.failed") }}
    </p>
    <div class="flex">
      <ButtonGroup>
        <Button
          size="sm"
          :aria-pressed="maintenanceFilterStatus === MaintenanceFilterStatus.MaintenanceFilterStatusScheduled"
          :variant="
            maintenanceFilterStatus == MaintenanceFilterStatus.MaintenanceFilterStatusScheduled ? 'default' : 'outline'
          "
          @click="maintenanceFilterStatus = MaintenanceFilterStatus.MaintenanceFilterStatusScheduled"
        >
          {{ $t("maintenance.filter.scheduled") }}
        </Button>
        <Button
          size="sm"
          :aria-pressed="maintenanceFilterStatus === MaintenanceFilterStatus.MaintenanceFilterStatusCompleted"
          :variant="
            maintenanceFilterStatus == MaintenanceFilterStatus.MaintenanceFilterStatusCompleted ? 'default' : 'outline'
          "
          @click="maintenanceFilterStatus = MaintenanceFilterStatus.MaintenanceFilterStatusCompleted"
        >
          {{ $t("maintenance.filter.completed") }}
        </Button>
        <Button
          size="sm"
          :aria-pressed="maintenanceFilterStatus === MaintenanceFilterStatus.MaintenanceFilterStatusBoth"
          :variant="
            maintenanceFilterStatus == MaintenanceFilterStatus.MaintenanceFilterStatusBoth ? 'default' : 'outline'
          "
          @click="maintenanceFilterStatus = MaintenanceFilterStatus.MaintenanceFilterStatusBoth"
        >
          {{ $t("maintenance.filter.both") }}
        </Button>
      </ButtonGroup>
      <Button
        v-if="props.currentItemId"
        class="ml-auto"
        size="sm"
        @click="
          openDialog(DialogID.EditMaintenance, {
            params: { type: 'create', itemId: props.currentItemId },
            onClose: result => {
              if (result) {
                refreshList();
              }
            },
          })
        "
      >
        <MdiPlus />
        {{ $t("maintenance.list.new") }}
      </Button>
    </div>
  </section>
  <section>
    <!-- begin -->
    <MaintenanceEditModal ref="maintenanceEditModal" @changed="refreshList" />
    <div v-if="loadState === 'success'" class="space-y-6">
      <section
        v-for="section in sections"
        :key="section.key"
        :aria-labelledby="`maintenance-${section.key}`"
        class="space-y-3"
      >
        <h2 :id="`maintenance-${section.key}`" class="font-semibold text-muted-foreground">
          {{ $t(`maintenance.filter.${section.key}`) }}
        </h2>
        <p v-if="!section.entries.length" class="text-sm text-muted-foreground">
          {{ $t(`maintenance.empty.${section.key}`) }}
        </p>
        <article
          v-for="e in section.entries"
          :key="e.id"
          class="rounded-xl border bg-card"
          data-testid="maintenance-entry"
        >
          <BaseSectionHeader class="border-b p-6">
            <span class="mb-2">
              <span v-if="!props.currentItemId">
                <NuxtLink
                  class="hover:underline"
                  :to="`/item/${(e as MaintenanceEntryWithDetails).itemID}/maintenance`"
                >
                  {{ (e as MaintenanceEntryWithDetails).itemName }}
                </NuxtLink>
                -
              </span>
              {{ e.name }}
            </span>
            <template #description>
              <div class="flex flex-wrap gap-2">
                <Badge v-if="validDate(e.completedDate)" variant="outline">
                  <MdiCheck class="mr-2" />
                  <span class="mr-1">{{ $t("maintenance.modal.completed_date") }}:</span>
                  <DateTime :date="e.completedDate" format="human" datetime-type="date" />
                </Badge>
                <Badge v-else-if="validDate(e.scheduledDate)" variant="outline">
                  <MdiCalendar class="mr-2" />
                  <span class="mr-1">{{ $t("maintenance.modal.scheduled_date") }}:</span>
                  <DateTime :date="e.scheduledDate" format="human" datetime-type="date" />
                </Badge>
                <TooltipProvider :delay-duration="0">
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge>
                        <Currency :amount="e.cost" />
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ $t("maintenance.modal.cost") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </template>
          </BaseSectionHeader>
          <div :class="{ 'p-6': e.description }">
            <Markdown :source="e.description" />
          </div>
          <ButtonGroup class="flex flex-wrap justify-end p-4">
            <Button
              size="sm"
              @click="
                openDialog(DialogID.EditMaintenance, {
                  params: { type: 'update', maintenanceEntry: e },
                  onClose: result => {
                    if (result) {
                      refreshList();
                    }
                  },
                })
              "
            >
              <MdiEdit />
              {{ $t("maintenance.list.edit") }}
            </Button>
            <Button v-if="!validDate(e.completedDate)" size="sm" variant="outline" @click="completeEntry(e)">
              <MdiCheck />
              {{ $t("maintenance.list.complete") }}
            </Button>
            <Button
              size="sm"
              variant="outline"
              @click="
                openDialog(DialogID.EditMaintenance, {
                  params: {
                    type: 'duplicate',
                    maintenanceEntry: e,
                    itemId: props.currentItemId!,
                  },
                  onClose: result => {
                    if (result) {
                      refreshList();
                    }
                  },
                })
              "
            >
              <MdiContentDuplicate />
              {{ $t("maintenance.list.duplicate") }}
            </Button>
            <Button size="sm" variant="destructive" @click="deleteEntry(e.id)">
              <MdiDelete />
              {{ $t("maintenance.list.delete") }}
            </Button>
          </ButtonGroup>
        </article>
      </section>
      <div v-if="props.currentItemId && !hasEntries">
        <button
          type="button"
          class="relative block w-full rounded-lg border-2 border-dashed p-12 text-center"
          @click="
            openDialog(DialogID.EditMaintenance, {
              params: { type: 'create', itemId: props.currentItemId },
              onClose: result => {
                if (result) {
                  refreshList();
                }
              },
            })
          "
        >
          <MdiWrenchClock class="inline size-16" />
          <span class="mt-2 block text-sm font-medium text-foreground">
            {{ $t("maintenance.list.create_first") }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
