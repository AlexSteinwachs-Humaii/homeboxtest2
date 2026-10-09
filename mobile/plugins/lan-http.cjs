const { withAndroidManifest } = require("expo/config-plugins");

// Self-hosted LAN servers may use HTTP. android.usesCleartextTraffic in
// app.json is not an Expo config field, so explicitly set the release manifest.
function allowLanHttp(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error("Android manifest has no application");
  application.$ = { ...application.$, "android:usesCleartextTraffic": "true" };
  return manifest;
}

function withLanHttp(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = allowLanHttp(mod.modResults);
    return mod;
  });
}
module.exports = withLanHttp;
module.exports.allowLanHttp = allowLanHttp;
