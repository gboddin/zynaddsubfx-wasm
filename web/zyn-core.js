/**
 * @file zyn-core.js
 * @description Shared core logic for ZynAddSubFX WASM.
 */

import { ZynAudioWorkletNode } from './zyn-audio-worklet-node.js';
import { ZynInstrument } from './zyn-instrument.js';
import { ZynStrudelOutput } from './strudel-output.js';

const instances = new Map();

/**
 * Gets or creates a Zyn engine instance.
 */
export async function getZynInstance(instanceId, baseUrl, audioCtx, version = '1') {
  if (instances.has(instanceId)) {
    const entry = instances.get(instanceId);
    return entry.output ? entry : entry.ready;
  }

  const zynOutput = new ZynStrudelOutput(audioCtx);
  const entry = { output: null, ready: null };
  
  entry.ready = zynOutput.init(
    `${baseUrl}/zyn_wasm.wasm?v=${version}`, 
    `${baseUrl}/zyn-worklet.js?v=${version}`,
    { connectToDestination: false }
  ).then(() => {
    entry.output = zynOutput;
    return entry;
  });
  
  instances.set(instanceId, entry);
  return entry.ready;
}

export { ZynAudioWorkletNode, ZynInstrument, ZynStrudelOutput };
