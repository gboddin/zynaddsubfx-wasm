/**
 * @file zyn-core.js
 * @description Shared core logic for ZynAddSubFX WASM.
 */

import { ZynAudioWorkletNode } from './zyn-audio-worklet-node.js';
import { ZynInstrument } from './zyn-instrument.js';
import { ZynStrudelOutput } from './strudel-output.js';

var instances = new Map();
var poolSize = 1;

/**
 * Sets the number of Zyn instances to pre-allocate.
 */
export function setZynPoolSize(size) {
    poolSize = size;
}

/**
 * Gets or creates a Zyn engine instance by index.
 */
export async function getZynInstanceByIndex(index, baseUrl, audioCtx, version) {
  if (version === undefined) version = '1';
  var instanceId = "instance_" + index;
  if (instances.has(instanceId)) {
    var entry = instances.get(instanceId);
    return entry.output ? entry : entry.ready;
  }

  var zynOutput = new ZynStrudelOutput(audioCtx);
  var entryData = { output: null, ready: null };
  
  entryData.ready = zynOutput.init(
    baseUrl + "/zyn_wasm.wasm?v=" + version, 
    baseUrl + "/zyn-worklet.js?v=" + version,
    { connectToDestination: false }
  ).then(function() {
    entryData.output = zynOutput;
    return entryData;
  });
  
  instances.set(instanceId, entryData);
  return entryData.ready;
}

/**
 * Gets or creates a Zyn engine instance by name (legacy support).
 */
export async function getZynInstance(instanceId, baseUrl, audioCtx, version) {
    // For now, map all names to instance 0 to enable part sharing
    return getZynInstanceByIndex(0, baseUrl, audioCtx, version);
}

export { ZynAudioWorkletNode, ZynInstrument, ZynStrudelOutput };
