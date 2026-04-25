#!/bin/bash
set -e

REPO_ROOT=$(pwd)
ZYN_BANKS="$REPO_ROOT/zynaddsubfx/instruments/banks"
OUTPUT_DIR="$REPO_ROOT/patches"

mkdir -p "$OUTPUT_DIR"

echo "Preparing patches from $ZYN_BANKS..."

find "$ZYN_BANKS" -name "*.xiz" | while read -r patch; do
    # Get filename without extension
    filename=$(basename "$patch" .xiz)
    
    # Strip leading number and dash (e.g., 0073-)
    clean_name=$(echo "$filename" | sed -E 's/^[0-9]+-//')
    
    # Lowercase and replace non-alphanumeric (except underscores) with underscores
    safe_name=$(echo "$clean_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_]+/_/g' | sed -E 's/_+/_/g' | sed -E 's/^_//;s/_$//')
    
    # Gunzip the file into the output directory
    zcat "$patch" > "$OUTPUT_DIR/$safe_name.xiz" 2>/dev/null || cp "$patch" "$OUTPUT_DIR/$safe_name.xiz"
done

echo "Patches prepared in $OUTPUT_DIR."
