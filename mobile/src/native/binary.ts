// What "a native binary" means for this client. The phone installs an iOS or
// Android binary. JavaScript-only fixes can ship later over the air against
// that binary's runtime version. The binary does not contain the server, a Go
// module, or an inventory database — relaunching still asks the server.

export type NativeBuildConfig = {
  app: {
    version?: string;
    runtimeVersion?: { policy?: string } | string;
    updates?: { enabled?: boolean; fallbackToCacheTimeout?: number; url?: string };
    ios?: { bundleIdentifier?: string; buildNumber?: string };
    android?: { package?: string; versionCode?: number };
    plugins?: unknown[];
  };
  eas: {
    build?: {
      sideload?: {
        distribution?: string;
        channel?: string;
        android?: { buildType?: string };
        ios?: { simulator?: boolean };
      };
      production?: {
        channel?: string;
        android?: { buildType?: string };
      };
    };
  };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

export const SIDELOAD_SCRIPT = "android:apk";

function bannedInventoryPackages(): string[] {
  return [
    ["expo", "sqlite"].join("-"),
    ["better", "sqlite3"].join("-"),
    ["sql", "js"].join("."),
    ["react-native", "sqlite", "storage"].join("-"),
  ];
}

export function assertNativeBuildConfig(config: NativeBuildConfig): string[] {
  const problems: string[] = [];
  const { app, eas, scripts, dependencies } = config;

  if (!app.ios?.bundleIdentifier) problems.push("iOS bundle identifier is missing");
  if (!app.android?.package) problems.push("Android package is missing");
  if (!app.ios?.buildNumber) problems.push("iOS build number is missing");
  if (typeof app.android?.versionCode !== "number") problems.push("Android versionCode is missing");

  const runtime = app.runtimeVersion;
  const policy = typeof runtime === "string" ? runtime : runtime?.policy;
  if (policy !== "appVersion") {
    problems.push("runtimeVersion must follow the app version so a JavaScript-only fix can target this binary");
  }
  if (app.updates?.fallbackToCacheTimeout !== 0) {
    problems.push("updates must not wait on a cached bundle before asking the server who you are");
  }
  if (app.updates?.enabled === true && !app.updates.url) {
    problems.push("over-the-air updates are enabled without a URL");
  }

  const sideload = eas.build?.sideload;
  if (sideload?.android?.buildType !== "apk") {
    problems.push("the sideload profile must build an installable Android APK, not only a store bundle");
  }
  if (sideload?.distribution !== "internal") {
    problems.push("the sideload profile must be an internal install, not a store submission");
  }
  if (!sideload?.channel) problems.push("the sideload profile needs a channel for a later JavaScript-only update");
  if (sideload?.ios?.simulator === true) {
    problems.push("the sideload iOS build must be a device binary, not a simulator build");
  }
  if (eas.build?.production?.android?.buildType === "apk") {
    problems.push("the store profile should be an app bundle, not the sideload APK");
  }

  const command = scripts[SIDELOAD_SCRIPT];
  if (!command || !command.includes("android-apk.sh")) {
    problems.push(`${SIDELOAD_SCRIPT} must run scripts/android-apk.sh`);
  }

  if (!dependencies.expo) problems.push("expected an Expo app");
  if (!dependencies["expo-updates"]) problems.push("expo-updates is required so a later JavaScript-only fix can ship over the air");
  if (!dependencies["babel-preset-expo"]) {
    problems.push("babel-preset-expo must be a direct dependency or the release binary cannot bundle JavaScript");
  }
  for (const name of bannedInventoryPackages()) {
    if (dependencies[name]) problems.push(`${name} must not be in the native client`);
  }

  const plugins = JSON.stringify(app.plugins ?? []);
  if (!plugins.includes("forbid-local-inventory")) {
    problems.push("prebuild must refuse an inventory database in the native project");
  }
  if (plugins.includes(bannedInventoryPackages()[0])) problems.push("the native plugins must not include a local inventory database");

  return problems;
}
