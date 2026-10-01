#!/usr/bin/env bash
# install-native-host.sh 로 등록한 것을 지운다. 앱 데이터(보관된 메시지, 로그)는 남긴다.
set -euo pipefail

HOST_NAME="dev.sorted.host"
MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
BIN="$HOME/Library/Application Support/Sorted/bin/sorted-native-host"

rm -f "$MANIFEST" "$BIN"
echo "지웠습니다: $MANIFEST"
echo "지웠습니다: $BIN"
