import { SessionGate } from "../src/screens/SessionGate";

export {
  Items,
  ItemDetail,
  ItemEdit,
  Locations,
  Search,
  PhotoAttach,
  Maintenance,
} from "../src/screens/inventory-ui";

export default function Index() {
  return <SessionGate />;
}
