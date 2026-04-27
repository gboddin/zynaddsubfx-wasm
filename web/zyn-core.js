/**
 * @file zyn-core.js
 * @description Shared core logic for ZynAddSubFX WASM.
 */

import { ZynStrudelOutput } from './strudel-output.js';

var instances = new Map();

/**
 * Gets or creates a Zyn engine instance by index.
 */
export function getZynInstanceByIndex(index, baseUrl, audioCtx, version) {
  if (version === undefined) version = '1';
  var instanceId = "instance_" + index;
  if (instances.has(instanceId)) {
    var entry = instances.get(instanceId);
    return entry;
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
  return entryData;
}
