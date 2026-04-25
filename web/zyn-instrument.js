/**
 * @description Implementation of the Zyn instrument for the Strudel pattern engine.
 */
export class ZynInstrument {
  /**
   * @param {ZynAudioWorkletNode} node The AudioWorkletNode instance.
   */
  constructor(node) {
    this.node = node;
    this.activeNotes = new Map(); // Map<key, boolean>
    this.partPatches = new Array(16).fill(null);
  }

  play(event, time = 0) {
    const partId = event.part || 0;
    const scheduleTime = time || this.node.context.currentTime;

    // 1. Handle Patch loading
    if (event.patch && event.patch !== this.partPatches[partId]) {
      this._loadPatchFromUrl(event.patch, partId);
    }

    // 2. Handle Parameters
    if (event.param) {
      this.node.setParam(event.param.id, event.param.value);
    }

    // 3. Handle MIDI CC
    if (event.cc) {
      const channel = (event.channel ?? 0) & 0x0F;
      this.node.sendMidi(0xB0 | channel, event.cc.number, Math.floor(event.cc.value * 127), scheduleTime);
    }

    // 4. Handle Notes
    let noteValue = event.note ?? event.midinote;
    
    // Convert frequency back to MIDI note if needed
    if (noteValue === undefined && event.freq !== undefined) {
      noteValue = 12 * Math.log2(event.freq / 440) + 69;
    }

    if (noteValue !== undefined) {
      const velocity = event.velocity !== undefined ? Math.floor(event.velocity * 127) : 100;
      const channel = (event.channel ?? 0) & 0x0F;
      const note = Math.floor(noteValue);

      if (velocity === 0) {
        this._noteOff(note, channel, scheduleTime);
      } else {
        this._noteOn(note, velocity, channel, scheduleTime);
        if (event.duration) {
          this._noteOff(note, channel, scheduleTime + event.duration);
        }
      }
    }
  }

  _noteOn(note, velocity, channel, time) {
    const key = `${channel}:${note}`;
    this.node.sendMidi(0x90 | channel, note, velocity, time);
    this.activeNotes.set(key, true);
  }

  _noteOff(note, channel, time) {
    const key = `${channel}:${note}`;
    this.node.sendMidi(0x80 | channel, note, 0, time);
    this.activeNotes.delete(key);
  }

  async _loadPatchFromUrl(url, partId) {
    this.partPatches[partId] = url;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch fail: ${resp.statusText}`);
      const xml = await resp.text();
      this.node.loadPatch(xml, partId);
    } catch (e) {
      console.error(`ZynInstrument: Patch load error (${url})`, e);
      this.partPatches[partId] = null;
    }
  }

  loadInternalPatch(path, partId = 0) {
    const internalPath = `internal:${path}`;
    if (this.partPatches[partId] === internalPath) return;
    this.partPatches[partId] = internalPath;
    this.node.loadInternalPatch(path, partId);
  }

  async loadPatch(url, partId = 0) {
    return this._loadPatchFromUrl(url, partId);
  }
}
