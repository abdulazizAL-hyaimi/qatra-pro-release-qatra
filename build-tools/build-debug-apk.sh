#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -x ./gradlew ]]; then GRADLE=./gradlew
elif command -v gradle >/dev/null 2>&1; then GRADLE=gradle
else echo "Gradle/Gradle Wrapper is not installed." >&2; exit 1
fi

"$GRADLE" \
  assembleAdminDebug \
  assembleReaderDebug \
  assembleCollectorDebug \
  assembleCashierDebug

echo "Debug APKs are under app/build/outputs/apk/<role>/debug/."
