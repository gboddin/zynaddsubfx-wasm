/**
 * strudel.js - Clean instance management for ZynAddSubFX WASM.
 *
 * registerSound(soundName, hapEvent) logic:
 *   1. Check if we have an instance for zf2_xxx (patchUrl)
 *   2. If it's booting, skip note
 *   3. If we don't have, start boot+loading parts, and skip note
 *   4. If yes, find a free part to play note in
 *   5. If no free part, skip note
 *   6. Disconnect proxy node when part is silent -> ready again, no fallback
 */

import {setHandlePartSilentRef, WarmWASMBuffer} from './strudel-output.js';
import { getZynInstanceByIndex } from './zyn-core.js';

// ─── Module State ───────────────────────────────────────────────────────────

/**
 * instancesByPatch: patchUrl -> { zyn, booting: bool, parts: [{ partId, busy, proxyNode }] }
 * Each Zyn instance handles exactly ONE patch across all 16 parts.
 */
var instancesByPatch = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Load a patch into all 16 parts of a Zyn instance.
 * Patches live inside WASM's virtual FS at /patches/<name>.xiz.
 */
function loadPatchIntoAllParts(zyn, patchUrl) {
  // Extract patch name from path: /patches/foo.xiz -> foo
  var patchName = patchUrl.replace(/^\/patches\//, '').replace(/\.xiz$/, '');

  for (var i = 0; i < 16; i++) {
    try {
      zyn.instrument.loadInternalPatch('/patches/' + patchName + '.xiz', i);
    } catch (e) {
      console.error('[ZynAddSubFX] Failed to load patch into part ' + i, e);
    }
  }
}

// ─── Instance Management ────────────────────────────────────────────────────

/**
 * Create a new Zyn instance for a patch.
 * Returns { zyn, booting, parts } or null on error.
 */
function createInstance(patchUrl, baseUrl, audioCtx, version) {
  var globalIndex = instancesByPatch.size;
  var entry = getZynInstanceByIndex(globalIndex, baseUrl, audioCtx, version);

  var instance = { instanceId: globalIndex, zyn: null, booting: true, parts: [] };
  instancesByPatch.set(patchUrl, instance);

  entry.ready.then(function() {
    instance.zyn = entry.output;
    instance.booting = false;

    // Populate the 16 parts
    for (var p = 0; p < 16; p++) {
      instance.parts.push({ partId: p, busy: false, proxyNode: null });
    }

    loadPatchIntoAllParts(entry.output, patchUrl);
  }).catch(function(e) {
    console.error('[ZynAddSubFX] Instance boot error for ' + patchUrl, e);
    instance.booting = false;
    instance.zyn = null;
  });

  return instance;
}

/**
 * Find a free part in an instance. Returns part or null.
 */
function findFreePart(instance) {
  if (!instance || !instance.zyn) return null;
  for (var i = 0; i < instance.parts.length; i++) {
    if (!instance.parts[i].busy) {
      return instance.parts[i];
    }
  }
  return null;
}

/**
 * Create a proxy GainNode for a part and connect to Zyn output.
 */
function createProxyNode(part, zyn, audioCtx) {
  var proxyNode = audioCtx.createGain();
  proxyNode.gain.value = 1.0;
  zyn.node.connect(proxyNode, part.partId + 1);
  return proxyNode;
}

// ─── Note Playback ──────────────────────────────────────────────────────────

/**
 * Play a note on a part. Returns { node: GainNode }.
 */
function playNote(instance, part, time, hapEvent, audioCtx, durationSeconds) {
  var zyn = instance.zyn;
  part.busy = true;
  // Create proxy node if not exists
  if (!part.proxyNode) {
      part.proxyNode = createProxyNode(part, zyn, audioCtx);
  }
  var midiNote = globalThis.valueToMidi(hapEvent)
  var combinedGain = (hapEvent.gain !== undefined ? hapEvent.gain : 1.0) * (hapEvent.velocity !== undefined ? hapEvent.velocity : 1.0);
  var duration = durationSeconds || hapEvent.duration || 0.5;

  zyn.instrument.play(Object.assign({}, hapEvent, {
    note: midiNote,
    velocity: 1.0,
    duration: duration,
    part: part.partId,
    channel: part.partId,
  }), time);
  // Reset silence counter for this part
  if (zyn.node && zyn.node.resetPartSilence) {
    zyn.node.resetPartSilence(part.partId);
  }
  return { node: part.proxyNode };
}

/**
 * Free a part and disconnect its proxy node.
 */
function freePart(instance, part) {
  part.busy = false;
  if (part.proxyNode) {
    try { part.proxyNode.disconnect(); } catch (e) { /* ignore */ }
    part.proxyNode = null;
  }
}

// ─── Silence Handler ────────────────────────────────────────────────────────

/**
 * Handle PART_SILENT messages from the worklet.
 * Frees busy parts that have become silent and disconnects proxy nodes.
 */
function handlePartSilent(partIndices, sendingInstance) {
  partIndices.forEach(function(partIdx) {
    instancesByPatch.forEach(function(instance) {
      if (!instance.zyn) return;
      // Only process if this instance sent the message
      if (instance.zyn !== sendingInstance) return;
      for (var j = 0; j < instance.parts.length; j++) {
        if (instance.parts[j].partId === partIdx && instance.parts[j].busy) {
          freePart(instance, instance.parts[j]);
        }
      }
    });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function bootZyn(options) {
  if (!options) options = {};
  var scriptUrl = new URL(import.meta.url);
  var version = scriptUrl.searchParams.get('v') || scriptUrl.search.slice(1) || '1';
  var baseUrl = options.baseUrl || scriptUrl.origin + scriptUrl.pathname.split('/').slice(0, -1).join('/');
  var audioCtx = options.audioContext || (typeof getAudioContext === 'function' ? getAudioContext() : new AudioContext());
  var registerFn = globalThis.registerSound || (globalThis.strudelScope && globalThis.strudelScope.registerSound);
  if (!registerFn) {
    console.warn('[ZynAddSubFX] registerSound not found. Continuing without Strudel registration.');
  }
  console.log('[ZynAddSubFX] Downloading WASM ...');
  await WarmWASMBuffer(baseUrl+'/zyn_wasm.wasm')
  console.log('[ZynAddSubFX] Booting from ' + baseUrl + ' (version: ' + version + ')');

  // Load patches from JSON
  var availablePatches = [];

  try {
      var response = await fetch(baseUrl + '/patches.json?v=' + version);
      if (response.ok) {
          availablePatches = await response.json();
          console.log('[ZynAddSubFX] Loaded ' + availablePatches.length + ' patches from patches.json.');
      }
  } catch (e) {
      console.error('[ZynAddSubFX] Error loading patches.json', e);
  }

  var registerZynSound = function (soundName, patchUrl) {
      if (!registerFn) return;
      try {
          registerFn(soundName, function (time, hapEvent) {
              // 1. Derive patchUrl from soundName if not provided
              var url = patchUrl;
              if (!url) {
                  var patchName = soundName.replace(/^zf2_/, '');
                  url = '/patches/' + patchName + '.xiz';
              }

              // 2. Check if we have an instance for this patch
              var instance = instancesByPatch.get(url);

              // 3. If it's booting, skip note
              if (instance && !instance.zyn && instance.booting) {
                  return {node: null};
              }

              // 4. If we don't have, start boot+loading parts, and skip note
              if (!instance) {
                  console.log(`[ZynAddSubFx] Skipping note because no free instance found for ${soundName}`)
                  instance = createInstance(url, baseUrl, audioCtx, version);
                  return {node: null};
              }
              // 5. Find a free part to play note in
              var part = findFreePart(instance);
              if (!part) {
                  console.log(`[ZynAddSubFx] Skipping note because no free parts found for ${soundName}`)
                  // 6. If no free part, skip note
                  return {node: null};
              }
              console.log(`Playing ${soundName} note on instance ${instance.instanceId} part ${part.partId}`)
              // Play the note
              var durationSeconds = hapEvent.duration || 0.5;

              var result = playNote(instance, part, time, hapEvent, audioCtx, durationSeconds);
              return result;
          });
      } catch (e) {
          console.error('[ZynAddSubFX] Failed to register ' + soundName + ':', e);
      }
  };
  // Allow remote patches
  if (options.patches) {
      Object.keys(options.patches).forEach(function (name) {
          registerZynSound(name, options.patches[name]);
      });
  }
  availablePatches.forEach(function (name) {
      registerZynSound('zf2_' + name, '/patches/' + name + '.xiz');
  });

  console.log('[ZynAddSubFX] Strudel Registration Complete.');
  // ─── Wire up worklet silence detection ──────────────────────────────
  setHandlePartSilentRef(handlePartSilent);
}
