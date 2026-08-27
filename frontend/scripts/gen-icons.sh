#!/usr/bin/env bash
# CLUTCHNEX PWA icon generator (Phase 13) — deterministic, no AI, no npm deps.
# Draws the brand tile with ImageMagick: violet gradient rounded square + a
# white "C" arc (the CLUTCHNEX mark), then exports every size the manifest and
# iOS need. Re-run after touching the design below:
#   bash frontend/scripts/gen-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p public/icons
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- master 1024 tile ---------------------------------------------------------
# Violet gradient (top #8B5CF6 → bottom #6D28D9) painted into a rounded square
convert -size 1024x1024 gradient:'#8B5CF6-'#6D28D9 "$TMP/grad.png"
convert -size 1024x1024 xc:none -tile "$TMP/grad.png" \
  -draw "roundrectangle 64,64 960,960 200,200" "$TMP/tile.png"
# The "C" — thick white arc opening right (35°→325°), soft glow pass underneath
convert "$TMP/tile.png" \
  \( -clone 0 -stroke 'rgba(255,255,255,0.35)' -strokewidth 100 -fill none \
     -draw "arc 322,322 702,702 35 325" -blur 0x14 \) \
  -composite \
  -stroke '#FFFFFF' -strokewidth 84 -fill none \
  -draw "arc 332,332 692,692 35 325" \
  -stroke 'rgba(255,255,255,0.9)' -strokewidth 18 \
  -draw "arc 332,332 692,692 35 325" \
  public/icons/_master.png

# --- exports --------------------------------------------------------------------
convert public/icons/_master.png -resize 512x512 public/icons/icon-512.png
convert public/icons/_master.png -resize 192x192 public/icons/icon-192.png
# iOS apple-touch-icon: opaque background (iOS dislikes transparency), 180px
convert -size 1024x1024 xc:'#070A14' public/icons/_master.png \
  -gravity center -compose over -composite -resize 180x180 public/icons/apple-touch-icon.png
# Maskable: full-bleed deep-navy canvas, tile in the 80% safe zone
convert -size 1024x1024 xc:'#0D1220' \( public/icons/_master.png -resize 700x700 \) \
  -gravity center -compose over -composite -resize 512x512 public/icons/icon-maskable-512.png
rm -f public/icons/_master.png

identify -format "%f %wx%h\n" public/icons/*.png
echo "icons done."
