#!/bin/sh
# Produce a sideloadable Android APK. Inventory is not packaged; the phone
# still has to reach the HomeBox server after install.
set -eu
cd "$(dirname "$0")/.."

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "ANDROID_HOME is not set. Point it at an Android SDK with platform 36, build-tools 36, and NDK 27.1.12297006." >&2
  exit 1
fi
if ! command -v java >/dev/null 2>&1; then
  echo "A JDK (17) is required to compile the Android binary." >&2
  exit 1
fi

pnpm exec expo prebuild --platform android --no-install

mkdir -p signing
KEYSTORE="${HOMEBOX_KEYSTORE:-$PWD/signing/sideload.keystore}"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias sideload -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass homebox-sideload -keypass homebox-sideload \
    -dname "CN=HomeBox sideload, O=HomeBox, C=US"
fi
export HOMEBOX_KEYSTORE="$KEYSTORE"
export NODE_ENV=production

cd android
./gradlew assembleRelease --no-daemon

APK="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "Gradle finished without $APK" >&2
  exit 1
fi

# The installable file is a zip of native code and the JS bundle. It must not
# carry the server's database or any Go source.
if unzip -l "$APK" | grep -E '(homebox\.db|\.go$)' >/dev/null; then
  echo "The APK contains an inventory database or Go source" >&2
  unzip -l "$APK" | grep -E '(homebox\.db|\.go$)' >&2 || true
  exit 1
fi
if ! unzip -l "$APK" | grep -q 'classes.dex'; then
  echo "The APK has no classes.dex; it is not an Android binary" >&2
  exit 1
fi
if ! unzip -l "$APK" | grep -Eq 'lib/.*/(libappmodules|libreactnative|libhermes)\.so'; then
  echo "The APK has no native libraries" >&2
  exit 1
fi

echo "Sideload this APK: android/$APK"
echo "Install: adb install -r android/$APK"
