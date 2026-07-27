#!/usr/bin/env bash
set -euo pipefail

: "${QATRA_KEYSTORE_PATH:?Set QATRA_KEYSTORE_PATH to an absolute path outside the project}"
: "${QATRA_KEYSTORE_PASSWORD:?Set QATRA_KEYSTORE_PASSWORD}"
: "${QATRA_KEY_PASSWORD:?Set QATRA_KEY_PASSWORD}"
QATRA_KEY_ALIAS="${QATRA_KEY_ALIAS:-qatra-pro-release}"

if [[ -e "$QATRA_KEYSTORE_PATH" ]]; then
  echo "Refusing to overwrite an existing keystore: $QATRA_KEYSTORE_PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$QATRA_KEYSTORE_PATH")"
keytool -genkeypair -v \
  -keystore "$QATRA_KEYSTORE_PATH" \
  -storetype JKS \
  -storepass:env QATRA_KEYSTORE_PASSWORD \
  -keypass:env QATRA_KEY_PASSWORD \
  -alias "$QATRA_KEY_ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Qatra Pro, OU=Mobile, O=Qatra Pro, C=YE"

echo "New release keystore created outside the source tree. Back it up securely."
