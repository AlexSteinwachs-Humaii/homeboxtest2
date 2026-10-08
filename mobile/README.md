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

Plain HTTP is allowed because self-hosted servers are often on a LAN without TLS. Do not point the app at a server you do not trust.

## Tests

```bash
cd mobile
pnpm test
```

The tests mock `/api/v1/users/login`, refresh, and `/api/v1/users/self`. They also assert this package does not embed an inventory database.
