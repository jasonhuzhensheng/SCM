#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
build_dir=$(mktemp -d /private/tmp/sayphoto-menu-build.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT
cp "$root/native/menu-search/MenuSearch.swift" "$build_dir/main.swift"
swiftc -O -module-cache-path /private/tmp/sayphoto-menu-swift-cache "$build_dir/main.swift" "$root/native/menu-search/ModelDownloads.swift" "$root/native/menu-search/SemanticSearch.swift" "$root/native/menu-search/DeletedPhotoState.swift" "$root/native/menu-search/Telemetry.swift" -o /private/tmp/SayPhotoMenu -framework AppKit -framework Vision -framework ImageIO -lsqlite3
/private/tmp/SayPhotoMenu --self-test
