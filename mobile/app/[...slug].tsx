import { useGlobalSearchParams } from "expo-router";

import { SessionGate } from "../src/screens/SessionGate";

// Vue addresses such as /profile and /collection/tools. The static server
// falls back to the Expo shell; this route names the tool instead of a blank page.
export default function DeferredRoute() {
  const params = useGlobalSearchParams();
  const slug = params.slug;
  const parts = Array.isArray(slug) ? slug : typeof slug === "string" && slug !== "" ? [slug] : [];
  const path = `/${parts.map((part) => decodeURIComponent(part)).join("/")}`;
  return <SessionGate requestedPath={path} />;
}
