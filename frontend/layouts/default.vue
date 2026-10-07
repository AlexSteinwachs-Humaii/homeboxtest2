<template>
  <div id="app">
    <!--
    Confirmation Modal is a singleton used by all components so we render
    it here to ensure it's always available. Possibly could move this further
    up the tree
    -->
    <ModalConfirm />
    <OutdatedModal v-if="status" :status="status" />
    <EntityCreateModal />
    <WipeInventoryDialog />
    <TagCreateModal />
    <ItemBarcodeModal />
    <AppQuickMenuModal :actions="quickMenuActions" />
    <AppScannerModal />
    <CollectionCreateModal />
    <CollectionJoinModal />
    <CollectionInviteCreateModal />
    <SidebarProvider :default-open="sidebarState">
      <Sidebar collapsible="icon">
        <SidebarHeader class="items-center">
          <NuxtLink to="/home" class="flex items-center gap-2 self-start p-2" aria-label="HomeBox">
            <AppLogo class="size-8 shrink-0" />
            <span class="text-xl font-semibold group-data-[collapsible=icon]:hidden">HomeBox</span>
          </NuxtLink>

          <CollectionSelector />

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                class="flex justify-center bg-primary text-primary-foreground drop-shadow-md hover:bg-primary/90 active:bg-primary/90 active:text-primary-foreground group-data-[collapsible=icon]:justify-start"
                :tooltip="$t('global.create')"
                hotkey="Shortcut: Ctrl+`"
              >
                <MdiPlus />
                <span>
                  {{ $t("global.create") }}
                </span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="z-40 min-w-[var(--reka-dropdown-menu-trigger-width)]">
              <DropdownMenuItem
                v-for="btn in dropdown"
                :key="btn.id"
                class="group cursor-pointer text-lg"
                @click="
                  () => {
                    if (btn.dialogId === DialogID.CreateEntity) {
                      if (btn.id == 0)
                        // create item
                        openDialog(btn.dialogId, {
                          params: { baseType: 'item' },
                        });
                      else if (btn.id == 1)
                        // create location
                        openDialog(btn.dialogId, {
                          params: { baseType: 'location' },
                        });
                    } else {
                      openDialog(btn.dialogId as NoParamDialogIDs);
                    }
                  }
                "
              >
                {{ btn.name.value }}
                <Shortcut
                  v-if="btn.shortcut"
                  class="invisible ml-auto group-hover:visible"
                  :keys="btn.shortcut.replace('Shift', '⇧').split('+')"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup
            v-for="(group, index) in navigationGroups"
            :key="index"
            :data-testid="index === 0 ? 'primary-navigation' : 'secondary-navigation'"
            :class="index === 1 ? 'mt-auto border-t border-sidebar-border text-muted-foreground' : ''"
          >
            <SidebarMenu>
              <template v-for="n in group" :key="n.id">
                <SidebarMenuItem v-if="!n.collapsible" :key="n.id">
                  <SidebarMenuLink
                    :href="n.to"
                    :class="{
                      'bg-accent text-accent-foreground': n.active?.value,
                      'text-nowrap': typeof locale === 'string' && locale.startsWith('zh-'),
                      '!text-base': index === 1,
                    }"
                    :tooltip="n.name.value"
                  >
                    <component :is="n.icon" />
                    <span>{{ n.name.value }}</span>
                  </SidebarMenuLink>
                </SidebarMenuItem>

                <Collapsible v-else :default-open="n.active.value" class="group/collapsible">
                  <SidebarMenuItem>
                    <SidebarMenuItem class="flex gap-1">
                      <SidebarMenuLink
                        :href="n.to"
                        :class="{
                          'bg-accent text-accent-foreground': n.active?.value,
                          'text-nowrap': typeof locale === 'string' && locale.startsWith('zh-'),
                          '!text-base': index === 1,
                        }"
                        :tooltip="n.name.value"
                      >
                        <component :is="n.icon" />
                        <span>{{ n.name.value }}</span>
                      </SidebarMenuLink>
                      <CollapsibleTrigger as-child>
                        <SidebarMenuButton class="flex size-10 items-center justify-center" :aria-label="n.name.value">
                          <MdiChevronRight
                            class="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                    </SidebarMenuItem>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem v-for="c in n.collapsible" :key="c.id">
                          <SidebarMenuLink
                            :href="c.to"
                            :class="{
                              'bg-accent text-accent-foreground': c.active?.value,
                              'text-nowrap': typeof locale === 'string' && locale.startsWith('zh-'),
                              '!text-base': index === 1,
                              'h-min py-0': true,
                            }"
                            :tooltip="c.name.value"
                          >
                            <span>{{ c.name.value }}</span>
                          </SidebarMenuLink>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </template>

              <!-- makes scanner accessible easily if using legacy header -->
              <SidebarMenuItem v-if="index === 0 && preferences.displayLegacyHeader" class="lg:hidden">
                <SidebarMenuButton
                  :class="{
                    'text-nowrap': typeof locale === 'string' && locale.startsWith('zh-'),
                  }"
                  :tooltip="$t('menu.scanner')"
                  @click.prevent="openDialog(DialogID.Scanner)"
                >
                  <MdiQrcodeScan />
                  <span>{{ $t("menu.scanner") }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter class="border-t border-sidebar-border">
          <div class="min-w-0 px-2 py-1 group-data-[collapsible=icon]:hidden">
            <p class="truncate text-sm font-medium">{{ username }}</p>
            <p class="truncate text-xs text-muted-foreground">
              {{ selectedCollection?.name }}
            </p>
          </div>
          <SidebarMenuButton
            class="flex justify-center group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:bg-destructive group-data-[collapsible=icon]:text-destructive-foreground group-data-[collapsible=icon]:shadow-sm group-data-[collapsible=icon]:hover:bg-destructive/90"
            :tooltip="$t('global.sign_out')"
            data-testid="logout-button"
            @click="logout"
          >
            <MdiLogout />
            <span>
              {{ $t("global.sign_out") }}
            </span>
          </SidebarMenuButton>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>
      <SidebarInset class="min-h-dvh max-w-full overflow-hidden bg-background-accent lg:bg-background">
        <div class="relative flex h-full flex-col justify-center">
          <!-- IMPORTANT: if you change the height of this div, alter the top value in the item edit page-->
          <div
            class="sticky top-0 z-20 flex h-[var(--header-height-mobile)] translate-y-[-0.5px] flex-col bg-secondary p-2 shadow-md sm:h-[var(--header-height)] sm:flex-row lg:hidden"
            data-testid="mobile-shell-header"
          >
            <div class="flex h-1/2 items-center gap-2 sm:h-auto">
              <SidebarTrigger variant="default" />
              <NuxtLink to="/home">
                <AppHeaderText class="h-6" />
              </NuxtLink>
            </div>
            <div class="sm:grow" />
            <div class="flex h-1/2 grow items-center justify-end gap-2 sm:h-auto">
              <Input
                v-model:model-value="search"
                class="h-9 grow sm:max-w-sm"
                :placeholder="$t('global.search')"
                type="search"
                @keyup.enter="triggerSearch"
              />
              <div>
                <Button size="icon" @click="triggerSearch">
                  <MdiMagnify />
                </Button>
              </div>
              <div>
                <Button size="icon" @click="openScanner">
                  <MdiQrcodeScan />
                </Button>
              </div>
            </div>
          </div>

          <div class="hidden items-center gap-3 px-6 py-5 lg:flex" data-testid="desktop-shell-actions">
            <SidebarTrigger class="[&_svg]:text-foreground" variant="ghost" />
            <form class="flex min-w-0 flex-1 items-center gap-2" role="search" @submit.prevent="triggerSearch">
              <Input
                v-model:model-value="search"
                class="max-w-lg bg-card"
                :aria-label="$t('global.search')"
                :placeholder="$t('global.search')"
                type="search"
              />
              <Button type="submit" variant="outline">
                <MdiMagnify />
                {{ $t("global.search") }}
              </Button>
            </form>
            <Button variant="outline" @click="openDialog(DialogID.Scanner)">
              <MdiQrcodeScan />
              {{ $t("menu.scan_label") }}
            </Button>
            <Button @click="openDialog(DialogID.CreateEntity, { params: { baseType: 'item' } })">
              <MdiPlus />
              {{ $t("menu.add_item") }}
            </Button>
          </div>

          <slot />
          <div class="grow" />

          <footer v-if="status" class="bottom-0 w-full pb-4 text-center">
            <p class="text-center text-sm">
              <span
                v-html="
                  DOMPurify.sanitize(
                    $t('global.footer.version_link', {
                      version: status.build.version.replace(/^v/, ''),
                      build: status.build.commit,
                    })
                  )
                "
              />
              ~
              <span v-html="DOMPurify.sanitize($t('global.footer.api_link'))" />
            </p>
          </footer>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>

<script lang="ts" setup>
  import { primaryNavigation, toolsNavigation, settingsNavigation, isNavigationActive } from "~/lib/navigation";
  import { useI18n } from "vue-i18n";
  import DOMPurify from "dompurify";
  import { useTagStore } from "~/stores/tags";
  import { useLocationStore } from "~~/stores/locations";
  import { useEntityTypeStore } from "~~/stores/entityTypes";

  import MdiHome from "~icons/mdi/home";
  import MdiFileTree from "~icons/mdi/file-tree";
  import MdiPackageVariant from "~icons/mdi/package-variant";
  import MdiToolboxOutline from "~icons/mdi/toolbox-outline";
  import MdiMagnify from "~icons/mdi/magnify";
  import MdiQrcodeScan from "~icons/mdi/qrcode-scan";
  import MdiCog from "~icons/mdi/cog";
  import MdiWrench from "~icons/mdi/wrench";
  import MdiPlus from "~icons/mdi/plus";
  import MdiLogout from "~icons/mdi/logout";
  import MdiChevronRight from "~icons/mdi/chevron-right";

  import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuSub,
    SidebarMenuSubItem,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuLink,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
  } from "@/components/ui/sidebar";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
  import { Shortcut } from "~/components/ui/shortcut";
  import { useDialog } from "~/components/ui/dialog-provider";
  import { Input } from "~/components/ui/input";
  import { Button } from "~/components/ui/button";
  import { toast } from "@/components/ui/sonner";
  import { DialogID, type NoParamDialogIDs } from "~/components/ui/dialog-provider/utils";
  import ModalConfirm from "~/components/ModalConfirm.vue";
  import OutdatedModal from "~/components/App/OutdatedModal.vue";
  import EntityCreateModal from "~/components/Entity/CreateModal.vue";
  import WipeInventoryDialog from "~/components/WipeInventoryDialog.vue";
  import TagCreateModal from "~/components/Tag/CreateModal.vue";
  import ItemBarcodeModal from "~/components/Item/BarcodeModal.vue";
  import AppQuickMenuModal from "~/components/App/QuickMenuModal.vue";
  import AppScannerModal from "~/components/App/ScannerModal.vue";
  import AppLogo from "~/components/App/Logo.vue";
  import AppHeaderText from "~/components/App/HeaderText.vue";
  import CollectionSelector from "~/components/Collection/Selector.vue";
  import CollectionCreateModal from "~/components/Collection/CreateModal.vue";
  import CollectionJoinModal from "~/components/Collection/JoinModal.vue";
  import CollectionInviteCreateModal from "~/components/Collection/InviteCreateModal.vue";

  const { t, locale } = useI18n();
  const username = computed(() => authCtx.user?.name || "User");
  const { selectedCollection } = useCollections();

  const { openDialog } = useDialog();

  const preferences = useViewPreferences();

  // get sidebar state from cookies
  const sidebarState = useCookie("sidebar:state", {
    readonly: true,
    decode: value => value !== "false",
  });

  const pubApi = usePublicApi();
  const { data: status } = useAsyncData(async () => {
    const { data } = await pubApi.status();

    return data;
  });

  const search = ref("");

  const triggerSearch = () => {
    if (search.value) {
      navigateTo(`/items?q=${encodeURIComponent(search.value)}`);
      search.value = "";
      // remove focus from input
      if (document.activeElement && "blur" in document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }
    }
  };

  const openScanner = () => {
    // request permission
    if (navigator.mediaDevices) {
      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then(() => {
          openDialog(DialogID.Scanner);
        })
        .catch(err => {
          console.error(err);
          toast.error(t("scanner.permission_denied"));
        });
    } else {
      toast.error(t("scanner.unsupported"));
    }
  };

  // Preload currency format
  useFormatCurrency();

  type DropdownItem = {
    id: number;
    name: ComputedRef<string>;
    shortcut: string;
    dialogId: DialogID;
  };

  const dropdown: DropdownItem[] = [
    {
      id: 0,
      name: computed(() => t("menu.create_item")),
      shortcut: "Shift+1",
      dialogId: DialogID.CreateEntity,
    },
    {
      id: 1,
      name: computed(() => t("menu.create_location")),
      shortcut: "Shift+2",
      dialogId: DialogID.CreateEntity,
    },
    {
      id: 2,
      name: computed(() => t("menu.create_tag")),
      shortcut: "Shift+3",
      dialogId: DialogID.CreateTag,
    },
  ];

  const route = useRoute();
  const router = useRouter();

  type NavItem = {
    icon: Component;
    active: ComputedRef<boolean>;
    id: string;
    name: ComputedRef<string>;
    to: string;
    collapsible?: {
      active: ComputedRef<boolean>;
      id: string;
      name: ComputedRef<string>;
      to: string;
    }[];
  };

  const destination = (id: string, key: string, to: string) => ({
    id,
    name: computed(() => t(key)),
    to,
    active: computed(() => isNavigationActive(route.path, to)),
  });

  const primaryIcons = { overview: MdiHome, items: MdiPackageVariant, locations: MdiFileTree, maintenance: MdiWrench };
  const primaryNav: NavItem[] = primaryNavigation.map(entry => ({
    ...destination(entry.id, entry.key, entry.to),
    icon: primaryIcons[entry.id],
  }));
  const tools = toolsNavigation.map(entry => destination(entry.id, entry.key, entry.to));
  const settings = settingsNavigation.map(entry => destination(entry.id, entry.key, entry.to));
  const secondaryNav: NavItem[] = [
    {
      ...destination("tools", "menu.tools", "/collection/tools"),
      icon: MdiToolboxOutline,
      active: computed(() => tools.some(child => child.active.value)),
      collapsible: tools,
    },
    {
      ...destination("settings", "menu.settings", "/profile"),
      icon: MdiCog,
      active: computed(() => settings.some(child => child.active.value)),
      collapsible: settings,
    },
  ];
  const navigationGroups = [primaryNav, secondaryNav];
  // Group labels alias a child route (Tools → collection tools, Settings → profile).
  // List each destination once so the quick menu does not show two "Tools" or two "Settings" entries.
  const nav = [...primaryNav, ...tools, ...settings];

  const quickMenuActions = reactive([
    ...dropdown.map(v => ({
      text: computed(() => v.name.value),
      dialogId: v.dialogId,
      shortcut: v.shortcut.split("+")[1] as string,
      id: v.id,
      type: "create" as const,
    })),
    ...nav.map(v => ({
      text: computed(() => v.name.value),
      href: v.to,
      type: "navigate" as const,
    })),
  ]);

  const tagStore = useTagStore();
  tagStore.ensureAllTagsFetched();

  const locationStore = useLocationStore();
  locationStore.ensureLocationsFetched();

  const entityTypeStore = useEntityTypeStore();
  entityTypeStore.ensureFetched();

  onMounted(() => {
    locationStore.refreshParents();
    locationStore.refreshTree();

    // Auto-open JoinModal when invitation token is in URL
    const token = route.query.token;
    if (typeof token === "string" && token.length > 0) {
      // Remove token from browser URL
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState(history.state, "", url.toString());

      // Sync router's state to clear route.query.token
      const { token: _, ...cleanQuery } = route.query;
      router.replace({ query: cleanQuery });

      openDialog(DialogID.JoinCollection, {
        params: { inviteCode: token },
      });
    }
  });

  onServerEvent(ServerEvent.TagMutation, () => {
    tagStore.refresh();
  });

  onServerEvent(ServerEvent.EntityMutation, () => {
    locationStore.refreshChildren();
    locationStore.refreshParents();
    locationStore.refreshTree();
  });

  const authCtx = useAuthContext();
  const api = useUserApi();

  async function logout() {
    await authCtx.logout(api);
    navigateTo("/");
  }
</script>
