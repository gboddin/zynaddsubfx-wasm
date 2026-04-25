import { ZynStrudelOutput } from './strudel-output.js';
import { getZynInstance } from './zyn-core.js';

let bootingPromise = null;

export async function bootZyn(options = {}) {
  if (bootingPromise) return bootingPromise;

  bootingPromise = (async () => {
    // Detect version from the current script URL
    const scriptUrl = new URL(import.meta.url);
    const version = scriptUrl.searchParams.get('v') || scriptUrl.search.slice(1) || '1';
    const baseUrl = options.baseUrl || scriptUrl.origin + scriptUrl.pathname.split('/').slice(0, -1).join('/');
    
    const audioCtx = options.audioContext || (typeof getAudioContext === 'function' ? getAudioContext() : new AudioContext());
    const registerFn = globalThis.registerSound || (globalThis.strudelScope && globalThis.strudelScope.registerSound);

    if (!registerFn) {
      console.warn('[ZynAddSubFX] registerSound not found. Continuing without Strudel registration.');
    }

    console.log(`[ZynAddSubFX] Booting from ${baseUrl} (version: ${version})`);

    // Load patches from JSON
    let availablePatches = [];
    try {
      const response = await fetch(`${baseUrl}/patches.json?v=${version}`);
      if (response.ok) {
        availablePatches = await response.json();
        console.log(`[ZynAddSubFX] Loaded ${availablePatches.length} patches.`);
      } else {
        console.error(`[ZynAddSubFX] Failed to fetch patches.json: ${response.status}`);
      }
    } catch (e) {
      console.error('[ZynAddSubFX] Error loading patches.json', e);
    }

    const registerZynSound = (soundName, patchUrl) => {
      if (!registerFn) return;
      try {
        registerFn(soundName, async (t, value, onEnded) => {
          const durationSeconds = value.duration || 0.5; 
          const getFreq = globalThis.getFrequencyFromValue || ((v) => {
              let f = v.freq || (v.note ? 440 * Math.pow(2, (v.note - 69) / 12) : 440);
              if (v.octave) f *= Math.pow(2, v.octave);
              return f;
          });

          const frequency = getFreq(value);
          const midiNote = 12 * Math.log2(frequency / 440) + 69;
          const combinedGain = (value.gain ?? 1.0) * (value.velocity ?? 1.0);

          const entry = await getZynInstance(soundName, baseUrl, audioCtx, version);
          const zyn = entry.output;
          
          const proxyNode = audioCtx.createGain();
          proxyNode.gain.value = 0;
          zyn.node.connect(proxyNode);

          const attack = value.attack || 0.01;
          const decay = value.decay || 0.1;
          const sustain = value.sustain ?? 1.0;
          const release = value.release || 0.1;
          const scheduleTime = t ?? audioCtx.currentTime;
          
          const g = proxyNode.gain;
          g.setValueAtTime(0, scheduleTime);
          g.linearRampToValueAtTime(combinedGain, scheduleTime + attack);
          g.linearRampToValueAtTime(combinedGain * sustain, scheduleTime + attack + decay);
          
          const noteOffTime = scheduleTime + durationSeconds;
          g.setValueAtTime(combinedGain * sustain, noteOffTime);
          g.linearRampToValueAtTime(0, noteOffTime + release);

          const wrappedOnEnded = () => {
            try { zyn.node.disconnect(proxyNode); } catch (e) {}
            onEnded();
          };

          if (patchUrl.startsWith('http')) {
              zyn.instrument.loadPatch(patchUrl, 0);
          } else {
              zyn.instrument.loadInternalPatch(patchUrl, 0);
          }
          
          zyn.instrument.play({ ...value, note: midiNote, velocity: 1.0, duration: durationSeconds }, scheduleTime);
          setTimeout(wrappedOnEnded, (durationSeconds + release) * 1000 + 100);
          return { node: proxyNode };
        });
      } catch (e) {
        console.error(`[ZynAddSubFX] Failed to register ${soundName}:`, e);
      }
    };

    if (options.patches) Object.entries(options.patches).forEach(([name, url]) => registerZynSound(name, url));
    availablePatches.forEach(name => registerZynSound(`zf2_${name}`, `/patches/${name}.xiz`));

    console.log('[ZynAddSubFX] Strudel Registration Complete.');
    await getZynInstance("boot_warmup", baseUrl, audioCtx, version);
  })();

  return bootingPromise;
}
