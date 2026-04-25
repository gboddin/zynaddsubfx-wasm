import { ZynStrudelOutput } from './strudel-output.js';
import { getZynInstanceByIndex, setZynPoolSize } from './zyn-core.js';

var bootingPromise = null;
var partStates = []; // Array of { zyn, partId, currentPatch, busy: boolean, lastUsed: number, proxyNode: GainNode }
var maxPoolSize = 1;

function stringHash(s) {
    var hash = 0;
    if (typeof s !== 'string') s = JSON.stringify(s);
    for (var i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function getPartForHap(soundName, patchUrl, baseUrl, audioCtx, version, hapValue) {
    var now = Date.now();
    
    // Use soundName and hap.id to create a preferred starting point in the pool
    // This provides "voice affinity" so the same rhythm slot tends to use the same part.
    var affinitySeed = soundName;
    if (hapValue && hapValue.hap && hapValue.hap.id) {
        affinitySeed += hapValue.hap.id;
    }
    var preferredIdx = stringHash(affinitySeed) % partStates.length;

    // 1. Try to find a free part that already has the correct patch
    // We search the whole pool but start from our preferred index
    for (var i = 0; i < partStates.length; i++) {
        var idx = (preferredIdx + i) % partStates.length;
        var p = partStates[idx];
        if (!p.busy && p.currentPatch === patchUrl) {
            p.busy = true;
            p.lastUsed = now;
            return Promise.resolve(p);
        }
    }
    
    // 2. Try to find ANY free part
    for (var i = 0; i < partStates.length; i++) {
        var idx = (preferredIdx + i) % partStates.length;
        var p = partStates[idx];
        if (!p.busy) {
            p.busy = true;
            p.lastUsed = now;
            return Promise.resolve(p);
        }
    }

    // 3. If pool is "full" (all parts in duration+tail phase), 
    // try to find a busy part that at least has the same patch.
    // This reuses a tailing voice for the same instrument, which is better than loading.
    for (var i = 0; i < partStates.length; i++) {
        var idx = (preferredIdx + i) % partStates.length;
        var p = partStates[idx];
        if (p.currentPatch === patchUrl) {
            p.busy = true;
            p.lastUsed = now;
            return Promise.resolve(p);
        }
    }

    // 4. Final fallback: Steal the Least Recently Used part
    console.warn("[ZynAddSubFX] Pool exhausted (" + partStates.length + " parts). Stealing LRU part for " + soundName);
    var sortedParts = partStates.slice().sort(function(a, b) { return a.lastUsed - b.lastUsed; });
    var stolenPart = sortedParts[0];
    stolenPart.busy = true;
    stolenPart.lastUsed = now;
    return Promise.resolve(stolenPart);
}

export function bootZyn(options) {
  if (!options) options = {};
  if (bootingPromise) return bootingPromise;

  if (options.poolSize) maxPoolSize = options.poolSize;

  bootingPromise = (async function() {
    // Detect version from the current script URL
    var scriptUrl = new URL(import.meta.url);
    var version = scriptUrl.searchParams.get('v') || scriptUrl.search.slice(1) || '1';
    var baseUrl = options.baseUrl || scriptUrl.origin + scriptUrl.pathname.split('/').slice(0, -1).join('/');
    
    var audioCtx = options.audioContext || (typeof getAudioContext === 'function' ? getAudioContext() : new AudioContext());
    var registerFn = globalThis.registerSound || (globalThis.strudelScope && globalThis.strudelScope.registerSound);

    if (!registerFn) {
      console.warn('[ZynAddSubFX] registerSound not found. Continuing without Strudel registration.');
    }

    console.log("[ZynAddSubFX] Booting from " + baseUrl + " (version: " + version + ")");

    // Load patches from JSON
    var availablePatches = [];
    try {
      var response = await fetch(baseUrl + "/patches.json?v=" + version);
      if (response.ok) {
        availablePatches = await response.json();
        console.log("[ZynAddSubFX] Loaded " + availablePatches.length + " patches.");
      }
    } catch (e) {
      console.error('[ZynAddSubFX] Error loading patches.json', e);
    }

    var registerZynSound = function(soundName, patchUrl) {
      if (!registerFn) return;
      try {
        registerFn(soundName, function(t, value, onEnded) {
          var durationSeconds = value.duration || 0.5; 
          var getFreq = globalThis.getFrequencyFromValue || (function(v) {
              var f = v.freq || (v.note ? 440 * Math.pow(2, (v.note - 69) / 12) : 440);
              if (v.octave) f *= Math.pow(2, v.octave);
              return f;
          });

          var frequency = getFreq(value);
          var midiNote = 12 * Math.log2(frequency / 440) + 69;
          var combinedGain = (value.gain !== undefined ? value.gain : 1.0) * (value.velocity !== undefined ? value.velocity : 1.0);

          return getPartForHap(soundName, patchUrl, baseUrl, audioCtx, version, value).then(function(partState) {
            var zyn = partState.zyn;
            var outputIndex = partState.partId + 1;
            
            // Re-use proxy node if it exists, otherwise create it
            if (!partState.proxyNode) {
                partState.proxyNode = audioCtx.createGain();
                partState.proxyNode.gain.value = 1.0;
                // Connect ONCE and keep it connected to avoid reconnection clicks
                zyn.node.connect(partState.proxyNode, outputIndex);
            }
            var proxyNode = partState.proxyNode;

            var scheduleTime = t !== undefined ? t : audioCtx.currentTime;
            
            // Apply note-specific gain via the persistent proxy node
            proxyNode.gain.setValueAtTime(combinedGain, scheduleTime);

            var wrappedOnEnded = function() {
              // We no longer disconnect proxyNode here!
              // Keeping it connected prevents the "micro click" of Web Audio connection changes.
              partState.busy = false;
              onEnded();
            };

            var loadPatchPromise = (partState.currentPatch !== patchUrl) ? 
                (patchUrl.startsWith('http') ? 
                    zyn.instrument.loadPatch(patchUrl, partState.partId) : 
                    Promise.resolve(zyn.instrument.loadInternalPatch(patchUrl, partState.partId))) :
                Promise.resolve();

            return loadPatchPromise.then(function() {
                partState.currentPatch = patchUrl;
                var playParams = Object.assign({}, value, {
                    note: midiNote,
                    velocity: 1.0,
                    duration: durationSeconds,
                    part: partState.partId,
                    channel: partState.partId
                });
                zyn.instrument.play(playParams, scheduleTime);
                
                // Keep the part busy for duration + some tail for Zyn's internal release/FX
                // Reduced tail to 1.5s for better pool turnover in fast patterns
                var tailSeconds = 1.5; 
                setTimeout(wrappedOnEnded, (durationSeconds + tailSeconds) * 1000);
                
                return { node: proxyNode };
            });
          });
        });
      } catch (e) {
        console.error("[ZynAddSubFX] Failed to register " + soundName + ":", e);
      }
    };

    if (options.patches) {
        Object.keys(options.patches).forEach(function(name) {
            registerZynSound(name, options.patches[name]);
        });
    }
    availablePatches.forEach(function(name) {
        registerZynSound("zf2_" + name, "/patches/" + name + ".xiz");
    });

    console.log('[ZynAddSubFX] Strudel Registration Complete.');
    
    // Pre-boot instances
    for (var i = 0; i < maxPoolSize; i++) {
        console.log("[ZynAddSubFX] Pre-booting instance " + i);
        var entry = await getZynInstanceByIndex(i, baseUrl, audioCtx, version);
        var zynInstance = entry.output;
        for (var j = 0; j < 16; j++) {
            partStates.push({ zyn: zynInstance, partId: j, currentPatch: null, busy: false, lastUsed: 0, proxyNode: null });
        }
    }
  })();

  return bootingPromise;
}
