const { withAppBuildGradle } = require("expo/config-plugins");

// A release APK has to be signed to install. This is a sideload key, not a Play
// Store key. The keystore is created by scripts/android-apk.sh and is not the
// server's inventory.

const MARKER = "homeboxSideload";

function withSideloadSigning(config) {
  // EAS supplies its own signing credentials. Only the local APK script owns
  // this ignored key; applying it on EAS would reference a missing keystore.
  if (process.env.HOMEBOX_LOCAL_SIDELOAD !== "1") return config;
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") return mod;
    let contents = mod.modResults.contents;
    if (contents.includes(MARKER)) return mod;

    const signing = `signingConfigs {
        ${MARKER} {
            storeFile file(System.getenv("HOMEBOX_KEYSTORE") ?: "../../signing/sideload.keystore")
            storePassword "homebox-sideload"
            keyAlias "sideload"
            keyPassword "homebox-sideload"
        }`;
    if (!contents.includes("signingConfigs {")) {
      throw new Error("android/app/build.gradle has no signingConfigs block to attach the sideload key");
    }
    contents = contents.replace("signingConfigs {", signing);

    const release = contents.match(/release \{[\s\S]*?signingConfig signingConfigs\.debug/);
    if (!release) {
      throw new Error("android/app/build.gradle release buildType does not sign with the debug key");
    }
    contents = contents.replace(
      /release \{[\s\S]*?signingConfig signingConfigs\.debug/,
      (block) => block.replace("signingConfig signingConfigs.debug", `signingConfig signingConfigs.${MARKER}`),
    );
    mod.modResults.contents = contents;
    return mod;
  });
}

module.exports = withSideloadSigning;
