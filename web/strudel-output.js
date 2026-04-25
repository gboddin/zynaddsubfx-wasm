import { ZynAudioWorkletNode } from './zyn-audio-worklet-node.js';
import { ZynInstrument } from './zyn-instrument.js';

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

    // 1. Fetch WASM Buffer
    const wasmResponse = await fetch(wasmUrl);
    const wasmBuffer = await wasmResponse.arrayBuffer();

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
          this.node.port.postMessage({ type: 'INITIALIZE', wasmBuffer }, [wasmBuffer]);
        } else if (msg.type === 'ENGINE_READY') {
          clearTimeout(timeout);
          this.initialized = true;
          if (options.connectToDestination !== false) this.node.connect(this.ctx.destination);
          resolve(this);
        } else if (msg.type === 'BOOT_ERROR') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      };
    });
  }

  zap(events) {
    if (!this.initialized) return;
    const eventList = Array.isArray(events) ? events : [events];
    eventList.forEach(event => {
      const data = event.value || event;
      const time = event.t !== undefined ? event.t : this.ctx.currentTime;
      this.instrument.play(data, time);
    });
  }
}
