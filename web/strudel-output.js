import { ZynAudioWorkletNode } from './zyn-audio-worklet-node.js';
import { ZynInstrument } from './zyn-instrument.js';

// Reference to the part-silence handler from strudel.js
var handlePartSilentRef = null;

/**
 * Set the handler for PART_SILENT messages from the worklet.
 */
export function setHandlePartSilentRef(ref) {
  handlePartSilentRef = ref;
}

var WasmBuffer = null;

export async function WarmWASMBuffer(wasmUrl) {
    // 1. Fetch WASM Buffer
    if (WasmBuffer === null) {
        console.log("Warming up WASM buffer...")
        const wasmResponse = await fetch(wasmUrl);
        WasmBuffer = await wasmResponse.arrayBuffer();
        return
    }
    console.log("Buffer already warm...")

}

/**
 * Strudel Output for ZynAddSubFX
 * Manages engine lifecycle and Strudel integration.
 */
export class ZynStrudelOutput {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.node = null;
    this.instrument = null;
    this.initialized = false;
  }

  async init(wasmUrl = './zyn_wasm.wasm', workletUrl = './zyn-worklet.js', options = {}) {
    if (this.initialized) return this;
    
    if (!this.ctx.audioWorklet) {
      throw new Error("AudioWorklet is not supported. Use HTTPS/localhost.");
    }

    const versionMatch = wasmUrl.match(/[?&]v=([^&]+)/);
    const version = versionMatch ? versionMatch[1] : '1';

    await WarmWASMBuffer(wasmUrl)
    // 2. Add Worklet Module
    const sep = workletUrl.includes('?') ? '&' : '?';
    const workletUrlWithVersion = workletUrl.includes('v=') ? workletUrl : `${workletUrl}${sep}v=${version}`;
    await this.ctx.audioWorklet.addModule(workletUrlWithVersion);

    // 3. Create Node and Instrument
    this.node = new ZynAudioWorkletNode(this.ctx);
    this.instrument = new ZynInstrument(this.node);

    // 4. Initialization Handshake
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Zyn Init Timeout")), 10000);
      
      const pingInterval = setInterval(() => {
        if (this.node) this.node.port.postMessage({ type: 'PING' });
      }, 100);

      this.node.port.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'PONG') {
          clearInterval(pingInterval);
          const wasmBuffer = WasmBuffer.slice(0);
          this.node.port.postMessage({ type: 'INITIALIZE', wasmBuffer }, [wasmBuffer]);
        } else if (msg.type === 'ENGINE_READY') {
          clearTimeout(timeout);
          this.initialized = true;
          if (options.connectToDestination !== false) this.node.connect(this.ctx.destination);
          resolve(this);
        } else if (msg.type === 'PART_SILENT') {
          // Phase 3: Handle silence detection from worklet
          if (handlePartSilentRef) {
            handlePartSilentRef(msg.parts, this);
          }
        } else if (msg.type === 'BOOT_ERROR') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      };
    });
  }
}
