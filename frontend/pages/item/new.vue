<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { Button } from "~/components/ui/button";
  import { toast } from "~/components/ui/sonner";
  import FormTextField from "~/components/Form/TextField.vue";
  import FormTextArea from "~/components/Form/TextArea.vue";
  import LocationSelector from "~/components/Location/Selector.vue";
  import TagSelector from "~/components/Tag/Selector.vue";
  import ItemSelector from "~/components/Item/Selector.vue";
  import FormCheckbox from "~/components/Form/Checkbox.vue";
  import PhotoUploader from "~/components/Form/PhotoUploader.vue";
  import PhotoUploaderPreview from "~/components/Form/PhotoUploaderPreview.vue";
  import {
    deletePhoto,
    rotatePhotoPreview,
    setPrimaryPhoto,
    type PhotoPreview,
  } from "~/components/Form/photo-uploader";
  import { useTagStore } from "~/stores/tags";
  import { useLocationStore } from "~/stores/locations";
  import { useEntityTypeStore } from "~/stores/entityTypes";
  import type { EntitySummary } from "~/lib/api/types/data-contracts";
  import { AttachmentTypes } from "~/lib/api/types/non-generated";
  import { captureDetailsUpdate } from "~/lib/items/capture";

  definePageMeta({ middleware: ["auth"] });
  const { t } = useI18n();
  useHead({ title: "HomeBox | " + t("item.capture.title") });
  const api = useUserApi();
  const route = useRoute();
  const tags = useTagStore();
  const locations = useLocationStore();
  const types = useEntityTypeStore();
  const { query, results, isLoading, triggerSearch } = useItemSearch(api, { immediate: false });
  const parent = ref<EntitySummary | null>(null);
  const loading = ref(false);
  const ready = ref(false);
  const error = ref("");
  const form = reactive({
    name: "",
    location: null as EntitySummary | null,
    quantity: 1,
    purchasePrice: "" as string | number,
    tags: [] as string[],
    description: "",
    serialNumber: "",
    modelNumber: "",
    manufacturer: "",
    insured: false,
    photos: [] as PhotoPreview[],
  });

  onMounted(async () => {
    try {
      await Promise.all([
        types.ensureFetched(),
        locations.ensureLocationsFetched(),
        locations.tree === null ? locations.refreshTree() : Promise.resolve(),
        tags.ensureAllTagsFetched(),
      ]);
      if (locations.Locations === null || tags.allTags === null || !types.itemTypes.length) {
        error.value = t("item.capture.load_failed");
        return;
      }
      // Apply the query only after the lists arrive, and only if the person
      // has not already chosen a place. The fieldset stays disabled until then.
      const locationId = typeof route.query.location === "string" ? route.query.location : null;
      if (locationId && !form.location) {
        form.location = locations.allLocations.find(location => location.id === locationId) ?? null;
      }
      ready.value = true;
    } catch {
      error.value = t("item.capture.load_failed");
    }
  });

  async function rotatePhoto(index: number) {
    const photo = form.photos[index];
    if (!photo) return;
    try {
      form.photos[index] = await rotatePhotoPreview(photo);
    } catch (err) {
      toast.error(t("components.entity.create_modal.toast.rotate_process_failed"));
      console.error(err);
    }
  }

  async function save() {
    if (loading.value) return;
    error.value = "";
    const entityTypeId = types.itemTypes[0]?.id;
    if (!ready.value || !entityTypeId) {
      error.value = t("item.capture.load_failed");
      return;
    }
    if (!form.name.trim() || !form.location?.id) {
      error.value = t("item.capture.required");
      return;
    }
    const price = form.purchasePrice === "" ? null : Number(form.purchasePrice);
    if (
      !Number.isFinite(form.quantity) ||
      form.quantity < 0 ||
      (price !== null && (!Number.isFinite(price) || price < 0))
    ) {
      error.value = t("item.capture.invalid_number");
      return;
    }
    loading.value = true;
    try {
      const result = await api.items.create({
        name: form.name.trim(),
        parentId: parent.value?.id ?? form.location.id,
        manufacturer: form.manufacturer,
        modelNumber: form.modelNumber,
        quantity: form.quantity,
        description: form.description,
        tagIds: form.tags,
        entityTypeId,
      });
      if (result.error || !result.data) {
        error.value = t("item.capture.create_failed");
        return;
      }
      const item = result.data;
      // Once created, never offer another create after a details or photo failure.
      if (price !== null || form.serialNumber || form.insured) {
        try {
          const update = await api.items.update(
            item.id,
            captureDetailsUpdate(
              item,
              {
                ...(price !== null ? { purchasePrice: price } : {}),
                serialNumber: form.serialNumber,
                insured: form.insured,
              },
              entityTypeId
            )
          );
          if (update.error) throw update.error;
        } catch {
          toast.error(t("item.capture.details_failed"));
        }
      }
      for (const photo of form.photos) {
        try {
          const upload = await api.items.attachments.add(
            item.id,
            photo.file,
            photo.photoName,
            AttachmentTypes.Photo,
            photo.primary
          );
          if (upload.error) throw upload.error;
        } catch {
          toast.error(t("item.capture.photo_failed"));
        }
      }
      await navigateTo(`/item/${item.id}`);
    } catch {
      error.value = t("item.capture.create_failed");
    } finally {
      loading.value = false;
    }
  }
</script>

<template>
  <div class="mx-auto w-full max-w-6xl px-4 py-8 lg:px-10" data-testid="add-item-page">
    <p class="mb-3 text-sm text-muted-foreground">
      <NuxtLink to="/items" class="hover:underline">{{ $t("global.items") }}</NuxtLink>
      / {{ $t("menu.add_item") }}
    </p>
    <form @submit.prevent="save">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ $t("item.capture.title") }}</h1>
          <p class="mt-2 text-muted-foreground">{{ $t("item.capture.findable") }}</p>
        </div>
        <div class="flex gap-2">
          <Button type="button" variant="outline" :disabled="loading" @click="navigateTo('/items')">
            {{ $t("global.cancel") }}
          </Button>
          <Button type="submit" :disabled="loading || !ready">{{ $t("item.capture.save") }}</Button>
        </div>
      </div>
      <p v-if="error" role="alert" class="mb-4 text-destructive">{{ error }}</p>
      <fieldset :disabled="loading || !ready" class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-6">
          <FormTextField
            v-model="form.name"
            :label="$t('global.name')"
            :required="true"
            :max-length="255"
            :autofocus="true"
          />
          <LocationSelector v-model="form.location" :label="$t('global.location')" />
          <div class="grid gap-4 sm:grid-cols-2">
            <FormTextField
              v-model.number="form.quantity"
              :label="$t('global.quantity')"
              type="number"
              :min="0"
              step="any"
              :required="true"
            />
            <FormTextField
              v-model="form.purchasePrice"
              :label="$t('item.capture.price')"
              type="number"
              :min="0"
              step="any"
            />
          </div>
          <TagSelector v-model="form.tags" :tags="tags.tags ?? []" />
          <FormTextArea v-model="form.description" :label="$t('item.capture.description')" :max-length="1000" />
        </div>
        <div class="min-w-0">
          <div class="rounded-xl border border-dashed border-primary bg-primary/5 p-6">
            <PhotoUploader
              :label="$t('item.capture.photo')"
              :button-label="$t('item.capture.choose_photo')"
              :existing-count="form.photos.length"
              @selected="photos => form.photos.push(...photos)"
            />
            <p class="mt-3 text-sm text-muted-foreground">{{ $t("item.capture.no_photo") }}</p>
          </div>
          <details class="mt-4 rounded-xl border bg-card p-4" data-testid="advanced-fields">
            <summary class="cursor-pointer">
              <span class="font-medium">{{ $t("items.advanced") }}</span>
              <span class="mt-1 block text-sm font-normal text-muted-foreground">
                {{ $t("item.capture.advanced_summary") }}
              </span>
            </summary>
            <div class="mt-4 flex flex-col gap-4">
              <FormTextField v-model="form.serialNumber" :label="$t('items.serial_number')" :max-length="255" />
              <FormTextField v-model="form.modelNumber" :label="$t('items.model_number')" :max-length="255" />
              <FormTextField v-model="form.manufacturer" :label="$t('items.manufacturer')" :max-length="255" />
              <ItemSelector
                v-model="parent"
                v-model:search="query"
                :label="$t('items.parent_item')"
                :items="results"
                item-text="name"
                :is-loading="isLoading"
                :trigger-search="triggerSearch"
              />
              <FormCheckbox v-model="form.insured" :label="$t('global.insured')" />
            </div>
          </details>
          <PhotoUploaderPreview
            :photos="form.photos"
            @delete="index => (form.photos = deletePhoto(form.photos, index))"
            @rotate="rotatePhoto"
            @set-primary="index => (form.photos = setPrimaryPhoto(form.photos, index))"
          />
        </div>
      </fieldset>
    </form>
  </div>
</template>
