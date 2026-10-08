# HomeBox mobile

Expo (React Native) client for a self-hosted HomeBox server. The phone signs in to the household's existing account. Inventory stays on the server.

This is not an Expo Router API and it does not add Go code. Inventory screens live in `src/screens` and are imported by the phone (`app/index.tsx`) and the browser (`app/index.web.tsx`) from `src/screens/inventory-ui`. That module is React Native primitives, rendered with react-native-web in the browser. It does not wrap the Vue app in `frontend/`. The API client in `src/api` speaks `/api/v1`.

## Sign in

1. Install and start the app (a development build or Expo Go):

   ```bash
   cd mobile
   pnpm install
   pnpm start
   ```

2. Enter the server address, for example `http://192.168.1.20:7745`. `https://` is used only when you type it. A bare address is treated as `http://`, which is how a LAN HomeBox usually listens.
3. Sign in with an existing account. The app posts to `/api/v1/users/login` and then loads `/api/v1/users/self`.
4. Close and reopen the app. The stored server address and session token are read from secure storage, then the app asks the server who you are again. A wrong password does not store a session.

The session is sent as an `Authorization` header. The phone does not rely on the browser cookies the website uses, and it does not open the server's inventory database or attachment files.

## Items and locations

After sign-in the app loads this account's items and locations from `GET /api/v1/entities` and the location tree from `GET /api/v1/entities/tree`. Pull to refresh, or tap Refresh. There is no on-phone copy: a failed refresh clears the list.

Creating or editing an item calls `POST` or `PUT /api/v1/entities`, then reads the row back. The detail screen shows the id the server returned. Locations can be browsed, including nested ones, so an item can be filed in one. A full location-tree editor is not included; a new location is only a name and an optional parent.

If the account belongs to more than one collection, the chips at the top switch collection. Inventory requests send that id as `X-Tenant`, the same header the website's collection selector sends. The phone does not filter another collection's rows itself.

## Search and scan

The search field calls `GET /api/v1/entities?q=` with the text as typed. Accent folding is the server's search. The phone does not rewrite the query, and it does not filter the list it already loaded.

Scan opens the camera for a barcode or QR label, and keeps a text field for when the camera cannot read the code. Results stay visible while the label remains in frame; tap Scan again to rearm the camera, or use Look up for a manual code. A HomeBox label (`/item/{id}`, `/location/{id}`, or `/a/{assetId}`) is looked up on the signed-in server with `X-Tenant`. The host printed on the label does not have to match the address used to sign in. A code from another collection is a no-match; that item is not opened.

A product barcode that is not already an item calls `GET /api/v1/products/search-from-barcode` and then shows that nothing in this collection matched. The app does not create an item from the catalog.

## Maintenance

Maintenance opens `GET /api/v1/maintenance?status=both` for the collection selected at the top, sent as `X-Tenant`. Due entries are listed first. Mark complete sends the same `PUT /api/v1/maintenance/{id}` body the website sends: the existing name, description, cost, and scheduled date, plus today's date as `completedDate`. The row is shown as complete only after a refresh returns that date. Another collection's entries are not in the list. The phone does not keep a maintenance log of its own.

## Photos

On an item, Take photo or Choose from library uploads the file with `POST /api/v1/entities/{id}/attachments` (`file`, `name`, `type=photo`, `primary`). The camera-roll copy is only a temporary upload source. HEIC is sent as the device provides it; the server makes the thumbnail.

The item screen then shows the attachment from a fresh `GET /api/v1/entities/{id}`. The image itself is `GET /api/v1/entities/{id}/attachments/{attachmentId}` with the login `attachmentToken` as `access_token` and the collection as `tenant`. A failed upload shows the error and does not add a local photo. After a reinstall, the same item still shows the file as long as the server has it.

## Native binary

The installable app is an iOS or Android binary, not a Go program and not a copy of the server. Closing it leaves the inventory on the server. Opening it again asks the server who you are. If that server does not answer, the phone shows an offline error and an empty inventory. There is no on-device replica and no offline sync.

A later JavaScript-only fix can ship over the air to a binary built with the same app version, once the app is linked to an Expo project. That update is the JavaScript bundle only. It does not carry inventory.

Sideload an Android APK (no store listing). This needs JDK 17 and an Android SDK with platform 36, build-tools 36, and NDK 27.1.12297006:

```bash
cd mobile
pnpm install
export ANDROID_HOME="$HOME/Android/Sdk"
pnpm run android:apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

`pnpm run android:apk` runs `scripts/android-apk.sh`: Expo prebuild, then `./gradlew assembleRelease`. The script sets `HOMEBOX_LOCAL_SIDELOAD=1` so the APK is signed with a sideload key created under `signing/` (gitignored). It is not a Play Store key. EAS builds leave that flag unset and use EAS-managed credentials instead. The LAN HTTP plugin explicitly enables cleartext traffic in the Android release manifest.

The same sideload profile on EAS, including an iOS device binary, and a later JavaScript-only fix:

```bash
cd mobile
pnpm dlx eas-cli init
pnpm dlx eas-cli build --platform android --profile sideload
pnpm dlx eas-cli build --platform ios --profile sideload
pnpm dlx eas-cli update --channel sideload --message "JavaScript-only fix"
```

Link an Expo account/project with `eas init`. If the CLI cannot write the dynamic config, set `EAS_PROJECT_ID` (including on the EAS build) or add `extra.eas.projectId` to `app.json`. The next native build then embeds the updates URL. Until that id exists, updates stay off so the phone does not call Expo on launch. A store listing is `pnpm dlx eas-cli build --profile production` and is not required to install the sideload binary.

## Web

The browser client is this same Expo app, not a second copy of the screens and not the Vue app in `frontend/`.

```bash
cd mobile
pnpm exec expo start --web
```

`app/index.web.tsx` and `app/index.tsx` both import item list, item detail, item edit, locations, search, photo attach, and maintenance from `src/screens/inventory-ui`. The web build renders those with react-native-web. Layouts are not forked. Platform files are the camera scanner (`ScanScreen.web.tsx`), secure storage (`session/secure.web.ts`), and the browser photo picker (`photos/picker.web.ts`).

On the website, sign in against the Bun server (the address is the page origin when the export was built with `EXPO_PUBLIC_HOMEBOX_API_ORIGIN=same`). The collection chips send `X-Tenant`, the same header the Vue collection selector used. New collection calls `POST /api/v1/groups` and then loads that collection's inventory. Search sends the query as typed. Attach a photo is a file input; the bytes still go to `POST /api/v1/entities/{id}/attachments`. Maintenance is scheduled on the item and marked complete from the shared maintenance screen.

Labels, QR, CSV import/export, collection import/export, profile, collection settings, members, invites, notifiers, entity types, and templates open from Tools. Each one calls an existing `/api/v1` route on the Bun server. Tags, language, and theme stay named and say they are not in this release. A Vue address such as `/profile` or `/reports/label-generator` opens that tool; an unknown address names the page instead of a blank shell.

The production container serves `pnpm run export:web` (`expo export --platform web`) from the Bun process on port 7745. That export is static files under `/app/web`. It does not include the Nuxt app, and the browser does not open `homebox.db`. Inventory calls go to same-origin `/api/v1` on the Bun server (`EXPO_PUBLIC_HOMEBOX_API_ORIGIN=same` is set only for that export). There are no Expo Router API routes.

## Tests

```bash
cd mobile
pnpm test
```

The phone tests mock `/api/v1`, including login and inventory. A Bun test in `server/src/contract/mobile-inventory.test.ts` runs the same client against the server and checks the new entity row. They also assert this package does not embed an inventory database.

The same account on both clients is `server/src/contract/cross-client.test.ts`. It signs in twice, writes an item and a completed maintenance row from the web session, and refreshes the phone session with `loadInventory` and `loadMaintenance`. A phone write is checked the other way. The other collection, and a second account, stay absent. Neither session is given the database path; every call is `/api/v1`.

The browser walk is `server/src/web-inventory.browser.test.ts`. Export the web client, then run it against the Bun server (it checks SQLite for the new item, the photo, and the completed maintenance row):

```bash
cd mobile && EXPO_PUBLIC_HOMEBOX_API_ORIGIN=same pnpm run export:web
cd ../server && HBOX_WEB_BROWSER=1 bun test src/web-inventory.browser.test.ts
```

Plain HTTP is allowed because self-hosted servers are often on a LAN without TLS. Do not point the app at a server you do not trust.
