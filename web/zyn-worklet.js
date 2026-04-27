
import createZynModule from '../zyn_wasm.js';

console.log("AudioWorklet: ES6 Module Loaded (v13).");

// Polyfills for restricted AudioWorklet environment
if (typeof self === 'undefined') {
    globalThis.self = globalThis;
}
if (typeof self.location === 'undefined') {
    self.location = {
        href: import.meta.url
    };
}

var BaseProcessor = typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {};

class ZynAudioWorkletProcessor extends BaseProcessor {
  constructor(options) {
    super();
    console.log("AudioWorklet: Processor Created (v13).");
    
    var maxParams = 4096;
    if (options && options.processorOptions) {
        maxParams = options.processorOptions.maxParams || 4096;
    }
    this.maxParams = maxParams;
    this.midiQueue = []; // Array of { time: number, data: number }
    
    this.initialized = false;
    this.initializing = false;

    this.handleMessage = this.handleMessage.bind(this);
    this.port.addEventListener('message', this.handleMessage);
    this.port.start();
    
    // Phase 3: Energy-based silence detection per part
    this.partEnergy = new Float32Array(16); // Current peak energy per part
    this.partSilenceFrames = new Int32Array(16); // Consecutive silence frames per part
    this.silenceThreshold = -50; // dB
    this.silenceFramesRequired = 200; // ~200ms at 48kHz block size
    this.lastSilentParts = new Int32Array(16); // Track which parts were silent last frame

    this.port.postMessage({ type: 'PROCESSOR_READY' });
  }

  handleMessage(event) {
    var msg = event.data;
    if (msg.type === 'PING') {
      this.port.postMessage({ type: 'PONG' });
    } else if (msg.type === 'INITIALIZE') {
      this.wasmBuffer = msg.wasmBuffer;
      var self = this;
      this._initialize().catch(function(err) {
          console.error("AudioWorklet: Boot Error", err);
          self.port.postMessage({ type: 'BOOT_ERROR', error: err.message });
      });
    } else if (msg.type === 'LOAD_INTERNAL_PATCH') {
      this._handleLoadInternalPatch(msg.path, msg.partId);
    } else if (msg.type === 'SEND_MIDI') {
      var packed = ((msg.status & 0xFF) << 24) | 
                     ((msg.noteOrCC & 0xFF) << 16) | 
                     ((msg.value & 0xFF) << 8);
      this.midiQueue.push({
        time: msg.time || 0,
        data: packed
      });
      // Keep queue sorted by time
      if (this.midiQueue.length > 1) {
        this.midiQueue.sort(function(a, b) { return a.time - b.time; });
      }
    } else if (msg.type === 'SET_PARAM') {
      if (this.initialized) {
        this.zyn_set_param(msg.paramId, msg.value);
      }
    } else if (msg.type === 'PART_RESET_SILENCE') {
      // Reset silence counter for a part (e.g., on note-on)
      if (msg.partId !== undefined && msg.partId >= 0 && msg.partId < 16) {
        this.partSilenceFrames[msg.partId] = 0;
        this.lastSilentParts[msg.partId] = 0;
      }
    }
  }

  _initialize() {
    if (this.initialized || this.initializing) return Promise.resolve();
    this.initializing = true;
    console.log("AudioWorklet: Starting WASM Boot via Glue Code...");
    
    var self = this;
    return (async function() {
      try {
        if (self.wasmBuffer) {
          console.log("AudioWorklet: Compiling WASM from transferred buffer...");
          self.wasmModule = await WebAssembly.compile(self.wasmBuffer);
          self.wasmBuffer = null; 
        }
        
        if (!self.wasmModule) {
            throw new Error("No WASM module or buffer provided");
        }

        console.log("AudioWorklet: Instantiating WASM via Emscripten...");
        var zyn = await createZynModule({
          instantiateWasm: function(imports, successCallback) {
            if (imports.env && !imports.env.emscripten_get_heap_max) {
              imports.env.emscripten_get_heap_max = function() { return 2147483648; }; 
            }
            WebAssembly.instantiate(self.wasmModule, imports).then(function(instance) {
                successCallback(instance);
            }).catch(function(e) {
                console.error("AudioWorklet: WASM Instantiate Fail", e);
                self.port.postMessage({ type: 'BOOT_ERROR', error: "WASM Instantiate Fail: " + e.message });
            });
            return {}; 
          },
          print: function(text) { console.log("[WASM stdout] " + text); },
          printErr: function(text) { console.error("[WASM stderr] " + text); }
        });

        self.zyn = zyn;
        
        self.zyn_init = zyn._zyn_init || zyn.zyn_init;
        self.zyn_midi_event = zyn._zyn_midi_event || zyn.zyn_midi_event;
        self.zyn_process = zyn._zyn_process || zyn.zyn_process;
        self.zyn_set_param = zyn._zyn_set_param || zyn.zyn_set_param;
        self.zyn_get_output_buffer_ptr = zyn._zyn_get_output_buffer_ptr || zyn.zyn_get_output_buffer_ptr;
        self.zyn_get_part_output_l_ptr = zyn._zyn_get_part_output_l_ptr || zyn.zyn_get_part_output_l_ptr;
        self.zyn_get_part_output_r_ptr = zyn._zyn_get_part_output_r_ptr || zyn.zyn_get_part_output_r_ptr;
        self.zyn_load_part_patch = zyn._zyn_load_part_patch || zyn.zyn_load_part_patch;
        self.malloc = zyn._malloc || zyn.malloc;
        self.free = zyn._free || zyn.free;

        if (typeof self.zyn_get_part_output_l_ptr !== 'function') {
            console.error("AudioWorklet: zyn_get_part_output_l_ptr NOT FOUND on module! Full keys:", Object.keys(zyn));
        }

        console.log("AudioWorklet: Calling zyn_init...");
        var sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
        self.zyn_init(sr);
        
        self.outputBufferPtr = self.zyn_get_output_buffer_ptr();
        self.outputBufferOffset = self.outputBufferPtr >> 2;

        self.partBufferOffsetsL = new Int32Array(16);
        self.partBufferOffsetsR = new Int32Array(16);
        for (var i = 0; i < 16; i++) {
            self.partBufferOffsetsL[i] = self.zyn_get_part_output_l_ptr(i) >> 2;
            self.partBufferOffsetsR[i] = self.zyn_get_part_output_r_ptr(i) >> 2;
        }

        self.heapF32 = zyn.HEAPF32 || zyn.buffer; 

        self.initialized = true;
        self.initializing = false;
        self.port.postMessage({ type: 'ENGINE_READY' });
        console.log("AudioWorklet: Engine Operational (v13).");

        if (self._pendingInternalPatch) {
          self._handleLoadInternalPatch(self._pendingInternalPatch.path, self._pendingInternalPatch.partId);
          self._pendingInternalPatch = null;
        }
        
        if (self._pendingPatch) {
          self._handleLoadPatch(self._pendingPatch.xml, self._pendingPatch.partId);
          self._pendingPatch = null;
        }
      } catch (e) {
        console.error("AudioWorklet: Boot Fatal", e);
        self.initializing = false;
      }
    })();
  }

  _handleLoadInternalPatch(path, partId) {
    if (!this.initialized) {
      this._pendingInternalPatch = { path: path, partId: partId };
      return;
    }
    try {
      console.log("AudioWorklet: Loading Internal Patch: " + path + " for part " + partId);
      if (this.zyn.FS && this.zyn.FS.analyzePath(path).exists) {
        var xmlData = this.zyn.FS.readFile(path, { encoding: 'utf8' });
        this._handleLoadPatch(xmlData, partId);
      } else {
        console.error("AudioWorklet: Internal patch not found: " + path);
      }
    } catch (e) {
      console.error("AudioWorklet: Internal Patch Error", e);
    }
  }

  _handleLoadPatch(xml, partId) {
    if (!this.initialized) {
      this._pendingPatch = { xml: xml, partId: partId };
      return;
    }
    try {
      var encodeUTF8 = function(str) {
        var out = [];
        for (var i = 0; i < str.length; i++) {
          var c = str.charCodeAt(i);
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
      var bytes = encodeUTF8(xml);
      var ptr = this.malloc(bytes.length + 1);
      var heapU8 = this.zyn.HEAPU8 || new Uint8Array(this.zyn.wasmMemory.buffer);
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
      for (var i = 0; i < outputs.length; i++) {
        for (var j = 0; j < outputs[i].length; j++) {
          outputs[i][j].fill(0);
        }
      }
      return true;
    }

    var output = outputs[0];
    if (!output) return true;

    var now = globalThis.currentTime || 0;
    
    while (this.midiQueue.length > 0 && this.midiQueue[0].time <= now) {
      var event = this.midiQueue.shift();
      this.zyn_midi_event(event.data);
    }

    this.zyn_process(this.outputBufferPtr, output[0].length, output.length);

    var heap = this.zyn.HEAPF32 || new Float32Array(this.zyn.wasmMemory.buffer);

    // Fill the primary (mixed) output
    var mixedOffset = this.outputBufferOffset;
    if (output.length === 2) {
      for (var i = 0; i < output[0].length; i++) {
        output[0][i] = heap[mixedOffset + i * 2];
        output[1][i] = heap[mixedOffset + i * 2 + 1];
      }
    } else {
      for (var i = 0; i < output[0].length; i++) output[0][i] = heap[mixedOffset + i];
    }

    // Fill additional part-specific outputs
    for (var p = 1; p < outputs.length; p++) {
        var partIdx = p - 1;
        if (partIdx >= 16) break;
        var outPart = outputs[p];
        var offL = this.partBufferOffsetsL[partIdx];
        var offR = this.partBufferOffsetsR[partIdx];
        if (outPart.length >= 2) {
            for (var i = 0; i < output[0].length; i++) {
                outPart[0][i] = heap[offL + i];
                outPart[1][i] = heap[offR + i];
            }
        }
    }

    // ── Phase 3: Energy monitoring per part ──────────────────────────────────
    var energyThreshold = Math.pow(10, this.silenceThreshold / 20); // -90dB in linear
    var silentParts = [];

    for (var p = 0; p < 16; p++) {
        var peakL = 0;
        var peakR = 0;
        var offL = this.partBufferOffsetsL[p];
        var offR = this.partBufferOffsetsR[p];
        
        for (var i = 0; i < output[0].length; i++) {
            var sampleL = Math.abs(heap[offL + i]);
            var sampleR = Math.abs(heap[offR + i]);
            if (sampleL > peakL) peakL = sampleL;
            if (sampleR > peakR) peakR = sampleR;
        }

        var energy = Math.max(peakL, peakR);
        this.partEnergy[p] = energy;

        if (energy < energyThreshold) {
            this.partSilenceFrames[p]++;
            if (this.partSilenceFrames[p] >= this.silenceFramesRequired) {
                if (this.lastSilentParts[p] === 0) {
                    silentParts.push(p);
                }
                this.lastSilentParts[p] = 1;
            }
        } else {
            this.partSilenceFrames[p] = 0;
            this.lastSilentParts[p] = 0;
        }
    }

    // Notify main thread about silent parts
    if (silentParts.length > 0) {
        this.port.postMessage({ type: 'PART_SILENT', parts: silentParts });
    }

    return true;
  }
}

registerProcessor('zyn-audio-worklet-processor', ZynAudioWorkletProcessor);
