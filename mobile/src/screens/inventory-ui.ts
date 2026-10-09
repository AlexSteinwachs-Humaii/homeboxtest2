// Single import path for inventory screens. The Expo native entry and the
// Expo web entry both import this module. Implementations are React Native
// primitives (react-native-web on the web build). They do not wrap the
// website components from the Nuxt app.
//
// Platform files are only for the camera scanner and secure storage.

export { Items } from "./shared/Items";
export { Locations } from "./shared/Locations";
export { Search } from "./shared/Search";
export { PhotoAttach } from "./shared/PhotoAttach";
export { ItemDetailScreen as ItemDetail, type ServerPhoto } from "./ItemDetailScreen";
export { ItemEditorScreen as ItemEdit, type EditorValues } from "./ItemEditorScreen";
export { MaintenanceScreen as Maintenance } from "./MaintenanceScreen";
