import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json is the static native identity. This file only turns on over-the-air
// JavaScript updates once an Expo project id exists (eas init writes it, or
// EAS_PROJECT_ID is set). A sideload build without that id still installs; it
// just cannot receive a later JavaScript-only fix until the binary is rebuilt
// with the project linked. Inventory is never part of an update.

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromExtra = config.extra?.eas?.projectId;
  const projectId = process.env.EAS_PROJECT_ID || (typeof fromExtra === "string" ? fromExtra : "");
  const updates = projectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${projectId}`,
        fallbackToCacheTimeout: 0,
        checkAutomatically: "ON_LOAD" as const,
      }
    : {
        enabled: false,
        fallbackToCacheTimeout: 0,
        checkAutomatically: "ON_LOAD" as const,
      };

  return {
    ...config,
    updates,
    extra: {
      ...config.extra,
      eas: projectId ? { projectId } : config.extra?.eas,
    },
  };
};
