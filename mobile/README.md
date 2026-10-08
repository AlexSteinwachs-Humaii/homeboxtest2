# HomeBox mobile

Expo (React Native) client for a self-hosted HomeBox server. The phone signs in to the household's existing account. Inventory stays on the server.

This is not an Expo Router API and it does not add Go code. Screens live in `src/screens`. The API client in `src/api` speaks `/api/v1` and can be imported by a later web build.

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

Scan opens the camera for a barcode or QR label, and keeps a text field for when the camera cannot read the code. A HomeBox label (`/item/{id}`, `/location/{id}`, or `/a/{assetId}`) is looked up on the signed-in server with `X-Tenant`. The host printed on the label does not have to match the address used to sign in. A code from another collection is a no-match; that item is not opened.

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

`pnpm run android:apk` runs `scripts/android-apk.sh`: Expo prebuild, then `./gradlew assembleRelease`. The APK is signed with a sideload key created under `signing/` (gitignored). It is not a Play Store key.

The same sideload profile on EAS, including an iOS device binary, and a later JavaScript-only fix:

```bash
cd mobile
pnpm exec eas init
pnpm exec eas build --platform android --profile sideload
pnpm exec eas build --platform ios --profile sideload
pnpm exec eas update --channel sideload --message "JavaScript-only fix"
```

`eas init` writes the Expo project id. The next native build then embeds the updates URL. Until that id exists, updates stay off so the phone does not call Expo on launch. A store listing is `eas build --profile production` and is not required to install the sideload binary.

## Tests

```bash
cd mobile
pnpm test
```

The phone tests mock `/api/v1`, including login and inventory. A Bun test in `server/src/contract/mobile-inventory.test.ts` runs the same client against the server and checks the new entity row. They also assert this package does not embed an inventory database.

Plain HTTP is allowed because self-hosted servers are often on a LAN without TLS. Do not point the app at a server you do not trust.
