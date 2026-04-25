#!/bin/bash
set -e

REPO_ROOT=$(pwd)
ZYN_DIR="$REPO_ROOT/zynaddsubfx"
PATCH_FILE="$REPO_ROOT/patch01.patch"

if [ ! -f "$PATCH_FILE" ]; then
    echo "Error: $PATCH_FILE not found"
    exit 1
fi

echo "Checking patch01.patch for ZynAddSubFX..."

cd "$ZYN_DIR"

if patch -p1 --dry-run < "$PATCH_FILE" > /dev/null 2>&1; then
    echo "Applying patch01.patch..."
    patch -p1 < "$PATCH_FILE"
else
    echo "patch01.patch already applied or conflict."
fi

echo "Patches processed."
