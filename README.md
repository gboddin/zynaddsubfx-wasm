# ZynAddSubFX WASM

This repository contains the WebAssembly port of the [ZynAddSubFX](https://github.com/zynaddsubfx/zynaddsubfx) synthesizer.

## Components

- `zynaddsubfx`: Git submodule pointing to the official repository.
- `wasm_entry`: C++ entry point and API for the WASM build.

## Build Instructions

### Requirements

- emscripten
- cmake
- wget
- git

### Instructions

```sh
git clone https://github.com/gbored/zynaddsubfx-wasm.git
cd zynaddsubfx-wasm
make
```

### Results

You can find the finished WASM module in wasm_entry/build/
