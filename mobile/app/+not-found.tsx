import { usePathname } from "expo-router";

import { SessionGate } from "../src/screens/SessionGate";

// A path the router does not own still explains itself. A blank Expo shell is a failure.
export default function NotFound() {
  const path = usePathname();
  return <SessionGate requestedPath={path || "/"} />;
}
