import { SessionGate } from "../src/screens/SessionGate";

// Expo web entry. Same screen module as app/index.tsx (the native entry).
// Sign-in chrome for the browser is layered around these screens later.
// Do not copy these screens into the old website package.
export {
  Items,
  ItemDetail,
  ItemEdit,
  Locations,
  Search,
  PhotoAttach,
  Maintenance,
} from "../src/screens/inventory-ui";

export default function WebIndex() {
  return <SessionGate />;
}
