#!/bin/bash
# Convierte assets/icon-1024.png en assets/icon.icns (todas las resoluciones de macOS).
set -euo pipefail
cd "$(dirname "$0")/.."
SET=out/Octos.iconset
rm -rf "$SET" && mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon-1024.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d assets/icon-1024.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o assets/icon.icns
rm -rf "$SET"
echo "Icono listo: assets/icon.icns"
