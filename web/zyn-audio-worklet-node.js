/**
 * @file zyn-audio-worklet-node.js
 * @description Main-thread interface for the Zyn WASM AudioWorklet.
 */

const BaseClass = typeof AudioWorkletNode !== 'undefined' ? AudioWorkletNode : class {};

export class ZynAudioWorkletNode extends BaseClass {
  constructor(context, { maxParams = 4096 } = {}) {
    super(context, 'zyn-audio-worklet-processor', {
      processorOptions: { maxParams },
      numberOfOutputs: 17, // 1 mixed + 16 parts
      outputChannelCount: new Array(17).fill(2)
    });
    this.maxParams = maxParams;
  }

  setParam(paramId, value) {
    this.port.postMessage({ type: 'SET_PARAM', paramId, value });
  }

  sendMidi(status, noteOrCC, value, time = 0) {
    this.port.postMessage({ type: 'SEND_MIDI', status, noteOrCC, value, time });
  }

  loadPatch(xml, partId = 0) {
    this.port.postMessage({ type: 'LOAD_PATCH', xml, partId });
  }

  loadInternalPatch(path, partId = 0) {
    this.port.postMessage({ type: 'LOAD_INTERNAL_PATCH', path, partId });
  }

  resetPartSilence(partId) {
    this.port.postMessage({ type: 'PART_RESET_SILENCE', partId });
  }
}
