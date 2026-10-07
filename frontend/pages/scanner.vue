<script setup lang="ts">
  import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
  import { useI18n } from "vue-i18n";
  import { ref, watch, onMounted, onBeforeUnmount } from "vue";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
  import { labelLookupTarget } from "@/lib/scanner";

  definePageMeta({ middleware: ["auth"] });

  const { t } = useI18n();
  const { selectedCollection } = useCollections();
  const code = ref("");
  const video = ref<HTMLVideoElement>();
  const sources = ref<MediaDeviceInfo[]>([]);
  const selectedSource = ref("");
  const errorMessage = ref("");
  const reader = new BrowserMultiFormatReader();
  const deviceKey = "homebox:lastUsedDeviceId";
  let disposed = false;
  let navigating = false;
  let generation = 0;

  function stopCamera() {
    reader.reset();
    const stream = video.value?.srcObject;
    if (typeof MediaStream !== "undefined" && stream instanceof MediaStream) {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  function lookup(value: string) {
    const target = labelLookupTarget(value);
    if (!target || disposed || navigating) return;
    navigating = true;
    stopCamera();
    return navigateTo(target);
  }

  watch(selectedSource, async source => {
    if (!source || disposed) return;
    const current = ++generation;
    stopCamera();
    errorMessage.value = "";
    try {
      localStorage.setItem(deviceKey, source);
    } catch {
      // Camera selection is optional when browser storage is unavailable.
    }
    try {
      await reader.decodeFromVideoDevice(source, video.value!, (result, error) => {
        if (disposed || current !== generation) return;
        if (result) void lookup(result.getText());
        if (error && !(error instanceof NotFoundException)) errorMessage.value = t("scanner.error");
      });
      if (disposed || current !== generation) stopCamera();
    } catch (error) {
      if (!disposed && current === generation) {
        errorMessage.value = t(
          error instanceof Error && error.name === "NotAllowedError" ? "scanner.permission_denied" : "scanner.error"
        );
      }
    }
  });

  onMounted(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      errorMessage.value = t("scanner.unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      if (disposed) return;
      const devices = await reader.listVideoInputDevices();
      if (disposed) return;
      sources.value = devices;
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(deviceKey);
      } catch {
        // Fall back to a rear camera or the first available source.
      }
      selectedSource.value =
        devices.find(device => device.deviceId === saved)?.deviceId ??
        devices.find(device => device.label.toLowerCase().includes("back"))?.deviceId ??
        devices[0]?.deviceId ??
        "";
      if (!selectedSource.value) errorMessage.value = t("scanner.no_sources");
    } catch (error) {
      if (!disposed) {
        errorMessage.value = t(
          error instanceof Error && error.name === "NotAllowedError" ? "scanner.permission_denied" : "scanner.error"
        );
      }
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    stopCamera();
  });

  function close() {
    disposed = true;
    stopCamera();
    return navigateTo("/items");
  }
</script>

<template>
  <main class="mx-auto w-full max-w-screen-2xl p-4 md:p-8">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold">{{ t("scanner.ready_title") }}</h1>
        <p class="mt-2 text-muted-foreground">
          {{
            t("scanner.looking_in", {
              collection: selectedCollection?.name ?? "",
            })
          }}
        </p>
      </div>
      <Button variant="outline" @click="close">{{ t("global.close") }}</Button>
    </header>
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)]">
      <section class="relative min-h-[520px] overflow-hidden rounded-2xl bg-[#1c2923]" :aria-label="t('scanner.title')">
        <video ref="video" class="absolute size-full object-cover" autoplay muted playsinline />
        <div class="pointer-events-none absolute inset-x-[12%] inset-y-[14%] rounded-2xl border-2 border-[#d7e1d2]">
          <span class="absolute -left-3 -top-3 size-7 border-l-[3px] border-t-[3px] border-[#668778]" />
          <span class="absolute -right-3 -top-3 size-7 border-r-[3px] border-t-[3px] border-[#668778]" />
          <span class="absolute -bottom-3 -left-3 size-7 border-b-[3px] border-l-[3px] border-[#668778]" />
          <span class="absolute -bottom-3 -right-3 size-7 border-b-[3px] border-r-[3px] border-[#668778]" />
        </div>
        <p class="absolute inset-x-0 bottom-0 bg-[#1c2923]/90 p-6 text-sm text-white">
          {{ t("scanner.frame_instruction") }}
        </p>
      </section>
      <section class="rounded-2xl border bg-card p-5">
        <h2 class="text-lg font-semibold">{{ t("scanner.manual_title") }}</h2>
        <p class="mb-4 mt-2 text-sm text-muted-foreground">
          {{ t("scanner.manual_help") }}
        </p>
        <form class="flex gap-2" @submit.prevent="lookup(code)">
          <label for="label-code" class="sr-only">{{ t("scanner.manual_title") }}</label>
          <Input id="label-code" v-model="code" class="min-w-0" placeholder="001-024" autocomplete="off" />
          <Button type="submit" :disabled="!code.trim()">{{ t("scanner.look_up") }}</Button>
        </form>
        <p v-if="errorMessage" role="alert" class="mt-4 text-sm text-destructive">
          {{ errorMessage }}
        </p>
        <div v-if="sources.length > 1" class="mt-6">
          <label id="camera-source-label" class="mb-2 block text-sm">{{ t("scanner.select_video_source") }}</label>
          <Select v-model="selectedSource">
            <SelectTrigger aria-labelledby="camera-source-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="source in sources" :key="source.deviceId" :value="source.deviceId">
                {{ source.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  </main>
</template>
