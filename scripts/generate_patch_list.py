import os
import json

def generate_patch_list():
    patches_dir = "patches"
    if not os.path.exists(patches_dir):
        print("Error: patches directory not found. Run prepare_patches.sh first.")
        return

    patches = []
    for filename in os.listdir(patches_dir):
        if filename.endswith(".xiz"):
            # Strip the .xiz extension
            patch_name = os.path.splitext(filename)[0]
            patches.append(patch_name)
    
    patches.sort()
    
    output_path = "web/patches.json"
    with open(output_path, "w") as f:
        json.dump(patches, f, indent=2)
    
    print(f"Generated {len(patches)} patches in {output_path}")

if __name__ == "__main__":
    generate_patch_list()
