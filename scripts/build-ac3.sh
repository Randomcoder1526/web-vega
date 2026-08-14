#!/bin/bash
# Build AC-3 (a52) WASM decoder using Emscripten
# Requires: docker OR emcc (Emscripten SDK)
#
# Usage:
#   chmod +x scripts/build-ac3.sh
#   ./scripts/build-ac3.sh
#
# Output: public/ac3-decoder.wasm + public/ac3-decoder.js

set -e

OUT_DIR="public"
WORK_DIR=$(mktemp -d)

echo "==> Cloning a52dec (liba52)..."
cd "$WORK_DIR"
git clone --depth 1 https://code.videolan.org/videolan/a52dec.git 2>/dev/null || \
  git clone --depth 1 https://github.com/nickoala/a52dec.git 2>/dev/null

cd a52dec

echo "==> Patching for Emscripten..."
# Remove configure check that fails under Emscripten
sed -i 's/AC_CHECK_LIB(m, sin)//g' configure.ac 2>/dev/null || true
sed -i 's/AC_CHECK_LIB(m, sin)//g' configure 2>/dev/null || true

echo "==> Compiling to WASM..."
emcc -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createAC3Module" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=4194304 \
  -s MAXIMUM_MEMORY=16777216 \
  -s EXPORTED_FUNCTIONS='["_a52_init","_a52_set_flags","_a52_frame","_a52_samples","_a52_free","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","HEAPU8","HEAPF32"]' \
  -s FILESYSTEM=0 \
  -s ENVIRONMENT='web' \
  -I include \
  liba52/a52_decode.c \
  liba52/bitstream.c \
  liba52/imdct.c \
  liba52/cpu.c \
  liba52/mmargs.c \
  liba52/sample.c \
  liba52/dynexp.c \
  -o "$OLDPWD/$OUT_DIR/ac3-decoder.js"

echo "==> Cleaning up..."
cd "$OLDPWD"
rm -rf "$WORK_DIR"

echo "==> Done! Files written to $OUT_DIR/ac3-decoder.{js,wasm}"
echo "    Total size: $(du -sh $OUT_DIR/ac3-decoder.wasm $OUT_DIR/ac3-decoder.js | tail -1)"
