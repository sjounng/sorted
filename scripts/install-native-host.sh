#!/usr/bin/env bash
# Chrome이 Sorted 중계 프로그램(native-host)을 찾을 수 있게 등록한다. macOS 전용.
#
#   ./scripts/install-native-host.sh
#
# 하는 일
#   1. app/native-host 를 release로 빌드한다.
#   2. 바이너리를 ~/Library/Application Support/Sorted/bin/ 에 복사한다.
#   3. Chrome의 NativeMessagingHosts 폴더에 호스트 매니페스트(dev.sorted.host.json)를 쓴다.
#      이 매니페스트는 우리 확장 ID에서만 호출을 허락한다 (allowed_origins).
#
# 되돌리기: ./scripts/uninstall-native-host.sh
set -euo pipefail

HOST_NAME="dev.sorted.host"
# extension/manifest.json 의 "key"로 고정된 ID. 누구 컴퓨터에서 로드해도 같다.
EXTENSION_ID="${SORTED_EXTENSION_ID:-phgmelpblnighkdkldoamokdbjbmencf}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS에서만 실행할 수 있습니다." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPPORT_DIR="$HOME/Library/Application Support/Sorted"
BIN_DIR="$SUPPORT_DIR/bin"
BIN="$BIN_DIR/sorted-native-host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST="$MANIFEST_DIR/$HOST_NAME.json"

echo "1/3 중계 프로그램 빌드"
cargo build --release --manifest-path "$ROOT/app/Cargo.toml" -p sorted-native-host

echo "2/3 $BIN 에 복사"
mkdir -p "$BIN_DIR"
chmod 700 "$SUPPORT_DIR"
install -m 755 "$ROOT/app/target/release/sorted-native-host" "$BIN"

echo "3/3 Chrome에 등록: $MANIFEST"
mkdir -p "$MANIFEST_DIR"
cat >"$MANIFEST" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Sorted native messaging host",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo
echo "완료. 확장 ID: $EXTENSION_ID"
echo "Chrome의 확장 프로그램 페이지에서 Sorted의 ID가 위와 같은지 확인하세요."
echo "로그: $SUPPORT_DIR/logs/native-host.log"
