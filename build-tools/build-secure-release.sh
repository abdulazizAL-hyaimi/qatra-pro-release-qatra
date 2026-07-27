#!/usr/bin/env bash
set -euo pipefail

: "${QATRA_KEYSTORE_PATH:?Set QATRA_KEYSTORE_PATH}"
: "${QATRA_KEYSTORE_PASSWORD:?Set QATRA_KEYSTORE_PASSWORD}"
: "${QATRA_KEY_ALIAS:?Set QATRA_KEY_ALIAS}"
: "${QATRA_KEY_PASSWORD:?Set QATRA_KEY_PASSWORD}"

if [[ -x ./gradlew ]]; then
  GRADLE=./gradlew
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=gradle
else
  echo "Gradle/Gradle Wrapper is not installed." >&2
  exit 1
fi

"$GRADLE" clean \
  assembleAdminRelease \
  assembleReaderRelease \
  assembleCollectorRelease \
  assembleCashierRelease

echo "Release APKs are under app/build/outputs/apk/. Verify each with apksigner before distribution."
