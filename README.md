# ZynAddSubFX WASM

This repository contains the WebAssembly port of the [ZynAddSubFX](https://github.com/zynaddsubfx/zynaddsubfx) synthesizer, optimized for high-performance live coding integration.

## Features

- **Multi-Instance Pooling**: Boot multiple Zyn instances (16 parts each) to handle complex, poly-instrumental patterns.
- **No-Freeze Live Coding**: All WASM instances are pre-booted. Adding new instruments during a performance is instantaneous and does not block the main thread.
- **Natural Effect Tails**: Full support for Zyn's internal synthesis release and effect trails (reverb/delay).
- **Voice Affinity**: Smart part allocation using `hap.id` affinity to minimize patch loading overhead.
- **Per-Event Strudel Effects**: Each note is connected via an individual part output, allowing Strudel's native effects (`lpf`, `delay`, `room`, etc.) to work independently on every sound.

## Usage in Strudel

Import the library and boot the Zyn pool:

```javascript
// Boot the engine with a pool of 2 instances (32 total parts/voices)
await import('http://localhost:8000/strudel.js').then(m => m.bootZyn({ poolSize: 2 }));

$: stack(
  note("<c4 _ d2 d3>").s("zf2_aura").lpf(1300),
  note("[c4 _ d2 d3]*4").s("zf2_hard_fat_lead").gain(.8)
)
```

### Options

`bootZyn(options)` accepts:
- `poolSize` (default: 1): Number of Zyn instances to pre-allocate. Each instance provides 16 parts.
- `baseUrl`: The root URL where the WASM and patch files are hosted.
- `audioContext`: An existing Web Audio context to use.

## Components

- `zynaddsubfx`: Git submodule pointing to the official repository.
- `wasm_entry`: C++ bridge and API layer for the WASM build.
- `web`: The JavaScript integration layer for Strudel and AudioWorklet.

## Build Instructions

### Requirements

- node
- emscripten (latest recommended)
- cmake
- wget
- git
- python3

### Build

```sh
git clone https://github.com/gbored/zynaddsubfx-wasm.git
cd zynaddsubfx-wasm
make
```

The finished WASM module and glue code will be in the `web/` directory.

## Local Development

To run the provided web interface and patches locally:

```sh
cd web
python3 server.py
```

Then access it at `http://localhost:8000`.
