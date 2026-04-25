
import createZynModule from '../zyn_wasm.js';

console.log("AudioWorklet: ES6 Module Loaded (v12).");

// Polyfills for restricted AudioWorklet environment
if (typeof self === 'undefined') {
    globalThis.self = globalThis;
}
if (typeof self.location === 'undefined') {
    self.location = {
        href: import.meta.url
    };
}

const BaseProcessor = typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {};

class ZynAudioWorkletProcessor extends BaseProcessor {
  constructor(options) {
    super();
    console.log("AudioWorklet: Processor Created (v12).");
    
    const { maxParams } = options.processorOptions;
    this.maxParams = maxParams;
    this.midiQueue = []; // Array of { time: number, data: number }
    
    this.initialized = false;
    this.initializing = false;

    this.port.addEventListener('message', this.handleMessage.bind(this));
    this.port.start();
    
    this.port.postMessage({ type: 'PROCESSOR_READY' });
  }

  handleMessage(event) {
    const msg = event.data;
    if (msg.type === 'PING') {
      this.port.postMessage({ type: 'PONG' });
    } else if (msg.type === 'INITIALIZE') {
      this.wasmBuffer = msg.wasmBuffer;
      this._initialize().catch(err => {
          console.error("AudioWorklet: Boot Error", err);
          this.port.postMessage({ type: 'BOOT_ERROR', error: err.message });
      });
    } else if (msg.type === 'LOAD_INTERNAL_PATCH') {
      this._handleLoadInternalPatch(msg.path, msg.partId);
    } else if (msg.type === 'SEND_MIDI') {
      const packed = ((msg.status & 0xFF) << 24) | 
                     ((msg.noteOrCC & 0xFF) << 16) | 
                     ((msg.value & 0xFF) << 8);
      this.midiQueue.push({
        time: msg.time || 0,
        data: packed
      });
      // Keep queue sorted by time
      if (this.midiQueue.length > 1) {
        this.midiQueue.sort((a, b) => a.time - b.time);
      }
    } else if (msg.type === 'SET_PARAM') {
      if (this.initialized) {
        this.zyn_set_param(msg.paramId, msg.value);
      }
    }
  }

  async _initialize() {
    if (this.initialized || this.initializing) return;
    this.initializing = true;
    console.log("AudioWorklet: Starting WASM Boot via Glue Code...");
    console.log("AudioWorklet: SharedArrayBuffer support:", typeof SharedArrayBuffer !== 'undefined');

    try {
      if (this.wasmBuffer) {
        console.log("AudioWorklet: Compiling WASM from transferred buffer...");
        this.wasmModule = await WebAssembly.compile(this.wasmBuffer);
        this.wasmBuffer = null; 
      }
      
      if (!this.wasmModule) {
          throw new Error("No WASM module or buffer provided");
      }

      console.log("AudioWorklet: Instantiating WASM via Emscripten...");
      const zyn = await createZynModule({
        instantiateWasm: (imports, successCallback) => {
          // Provide missing Emscripten runtime functions if they are requested by the WASM but missing from imports
          if (imports.env && !imports.env.emscripten_get_heap_max) {
            imports.env.emscripten_get_heap_max = () => 2147483648; // 2GB fallback
          }
          WebAssembly.instantiate(this.wasmModule, imports).then(instance => {
              successCallback(instance);
          }).catch(e => {
              console.error("AudioWorklet: WASM Instantiate Fail", e);
              this.port.postMessage({ type: 'BOOT_ERROR', error: "WASM Instantiate Fail: " + e.message });
          });
          return {}; 
        },
        print: (text) => console.log(`[WASM stdout] ${text}`),
        printErr: (text) => console.error(`[WASM stderr] ${text}`)
      });

      this.zyn = zyn;
      this.zyn_init = zyn._zyn_init;
      this.zyn_midi_event = zyn._zyn_midi_event;
      this.zyn_process = zyn._zyn_process;
      this.zyn_set_param = zyn._zyn_set_param;
      this.zyn_get_output_buffer_ptr = zyn._zyn_get_output_buffer_ptr;
      this.zyn_load_part_patch = zyn._zyn_load_part_patch;
      this.malloc = zyn._malloc;
      this.free = zyn._free;

      console.log("AudioWorklet: Calling zyn_init...");
      const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
      this.zyn_init(sr);
      
      this.outputBufferPtr = this.zyn_get_output_buffer_ptr();
      this.outputBufferOffset = this.outputBufferPtr >> 2;
      this.heapF32 = zyn.HEAPF32 || zyn.buffer; // Fallback for newer Emscripten

      this.initialized = true;
      this.initializing = false;
      this.port.postMessage({ type: 'ENGINE_READY' });
      console.log("AudioWorklet: Engine Operational (v12).");

      if (this._pendingInternalPatch) {
        this._handleLoadInternalPatch(this._pendingInternalPatch.path, this._pendingInternalPatch.partId);
        this._pendingInternalPatch = null;
      }
      
      if (this._pendingPatch) {
        this._handleLoadPatch(this._pendingPatch.xml, this._pendingPatch.partId);
        this._pendingPatch = null;
      }
    } catch (e) {
      console.error("AudioWorklet: Boot Fatal", e);
      this.initializing = false;
    }
  }

  _handleLoadInternalPatch(path, partId) {
    if (!this.initialized) {
      this._pendingInternalPatch = { path, partId };
      return;
    }
    try {
      console.log(`AudioWorklet: Loading Internal Patch: ${path} for part ${partId}`);
      if (this.zyn.FS && this.zyn.FS.analyzePath(path).exists) {
        const xmlData = this.zyn.FS.readFile(path, { encoding: 'utf8' });
        this._handleLoadPatch(xmlData, partId);
      } else {
        console.error(`AudioWorklet: Internal patch not found: ${path}`);
      }
    } catch (e) {
      console.error("AudioWorklet: Internal Patch Error", e);
    }
  }

  _handleLoadPatch(xml, partId) {
    if (!this.initialized) {
      this._pendingPatch = { xml, partId };
      return;
    }
    try {
      const encodeUTF8 = (str) => {
        const out = [];
        for (let i = 0; i < str.length; i++) {
          let c = str.charCodeAt(i);
          if (c < 128) out.push(c);
          else if (c < 2048) {
            out.push((c >> 6) | 192);
            out.push((c & 63) | 128);
          } else {
            out.push((c >> 12) | 224);
            out.push(((c >> 6) & 63) | 128);
            out.push((c & 63) | 128);
          }
        }
        return new Uint8Array(out);
      };
      const bytes = encodeUTF8(xml);
      const ptr = this.malloc(bytes.length + 1);
      const heapU8 = this.zyn.HEAPU8 || new Uint8Array(this.zyn.wasmMemory.buffer);
      heapU8.set(bytes, ptr);
      heapU8[ptr + bytes.length] = 0; // Null terminator
      this.zyn_load_part_patch(partId, ptr);
      this.free(ptr);
      console.log("AudioWorklet: Patch Applied.");
    } catch (e) {
      console.error("AudioWorklet: Patch Error", e);
    }
  }

  process(inputs, outputs) {
    if (!this.initialized) {
      for (const output of outputs) for (const chan of output) chan.fill(0);
      return true;
    }

    const output = outputs[0];
    if (!output) return true;

    // Use current context time. In AudioWorklet, currentTime is available.
    const now = currentTime;
    
    while (this.midiQueue.length > 0 && this.midiQueue[0].time <= now) {
      const event = this.midiQueue.shift();
      this.zyn_midi_event(event.data);
    }

    this.zyn_process(this.outputBufferPtr, output[0].length, output.length);

    const offset = this.outputBufferOffset;
    const heap = this.zyn.HEAPF32 || new Float32Array(this.zyn.wasmMemory.buffer);
    if (output.length === 2) {
      for (let i = 0; i < output[0].length; i++) {
        output[0][i] = heap[offset + i * 2];
        output[1][i] = heap[offset + i * 2 + 1];
      }
    } else {
      for (let i = 0; i < output[0].length; i++) output[0][i] = heap[offset + i];
    }

    return true;
  }
}

registerProcessor('zyn-audio-worklet-processor', ZynAudioWorkletProcessor);
