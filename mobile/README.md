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

## Photos

On an item, Take photo or Choose from library uploads the file with `POST /api/v1/entities/{id}/attachments` (`file`, `name`, `type=photo`, `primary`). The camera-roll copy is only a temporary upload source. HEIC is sent as the device provides it; the server makes the thumbnail.

The item screen then shows the attachment from a fresh `GET /api/v1/entities/{id}`. The image itself is `GET /api/v1/entities/{id}/attachments/{attachmentId}` with the login `attachmentToken` as `access_token` and the collection as `tenant`. A failed upload shows the error and does not add a local photo. After a reinstall, the same item still shows the file as long as the server has it.

## Tests

```bash
cd mobile
pnpm test
```

The phone tests mock `/api/v1`, including login and inventory. A Bun test in `server/src/contract/mobile-inventory.test.ts` runs the same client against the server and checks the new entity row. They also assert this package does not embed an inventory database.

Plain HTTP is allowed because self-hosted servers are often on a LAN without TLS. Do not point the app at a server you do not trust.
