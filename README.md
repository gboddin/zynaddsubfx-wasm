# ZynAddSubFX WASM

This repository contains the WebAssembly port of the [ZynAddSubFX](https://github.com/zynaddsubfx/zynaddsubfx) synthesizer.

## Components

- `zynaddsubfx`: Git submodule pointing to the official repository.
- `wasm_entry`: C++ entry point and API for the WASM build.

## Running locally:

Download the web.zip provided on the [Release](https://github.com/gboddin/zynaddsubfx-wasm/releases) section and run server.py

Confirm it is working at http://localhost:8000

In strudel:

```js
await import('http://localhost:8000/strudel.js?v=99').then(m => m.bootZyn());
$: note("<60 _ _ _>").s("zf2_at_saturnus").release(1.05)
$: note("60 _ 67 _").s("zf2_compad").lpf(300)
```

## Build Instructions

### Requirements

- node
- emscripten
- cmake
- wget
- git
- python3

### Instructions

```sh
git clone https://github.com/gbored/zynaddsubfx-wasm.git
cd zynaddsubfx-wasm
make
```

### Results

You can find the finished WASM module in web/
