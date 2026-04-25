import { getZynInstance } from './zyn-core.js';

const startBtn = document.getElementById('startBtn');
const status = document.getElementById('status');
const logEl = document.getElementById('console');

function log(msg) {
    const div = document.createElement('div');
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

let audioCtx = null;
let zyn = null;
let isPlaying = false;
let sequenceInterval = null;
let currentNoteIndex = 0;
const sequence = [60, 62, 64, 65, 67, 69, 71, 72]; // C4 to C5 major scale
const patchSelect = document.createElement('select');

async function ensureEngine() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    if (!zyn) {
        const version = 'v' + Date.now();
        log(`Booting ZynAddSubFX (${version})...`);
        const entry = await getZynInstance("demo_instance", ".", audioCtx, version);
        zyn = entry.output;
        zyn.node.connect(audioCtx.destination);
        log('Engine Ready.');
    }
    return zyn;
}

function stopSequence() {
    isPlaying = false;
    startBtn.textContent = 'Start Sequence';
    clearInterval(sequenceInterval);
    if (zyn) {
        // Send NoteOff for the current note
        zyn.instrument.play({ note: sequence[currentNoteIndex], velocity: 0 }, audioCtx.currentTime);
    }
    log('Sequence Stopped.');
}

function startSequence() {
    isPlaying = true;
    startBtn.textContent = 'Stop';
    log(`Starting Sequence with patch: ${patchSelect.value}`);
    
    sequenceInterval = setInterval(() => {
        const note = sequence[currentNoteIndex];
        const patchName = patchSelect.value;
        
        // Load patch if changed (ZynInstrument handles caching)
        zyn.instrument.loadInternalPatch(`/patches/${patchName}.xiz`, 0);
        
        // Play note
        // We use a short duration for the loop
        zyn.instrument.play({ note: note, velocity: 0.8, duration: 0.4 }, audioCtx.currentTime);
        
        currentNoteIndex = (currentNoteIndex + 1) % sequence.length;
    }, 500); // 120 BPM roughly
}

startBtn.onclick = async () => {
    if (isPlaying) {
        stopSequence();
        return;
    }

    status.textContent = 'Booting...';
    try {
        await ensureEngine();
        status.textContent = 'Running';
        startSequence();
    } catch (err) {
        console.error(err);
        status.textContent = 'Error';
        log(`Error: ${err.message}`);
    }
};

// Initial patch loading
(async () => {
    try {
        const patchResponse = await fetch('./patches.json');
        const patches = await patchResponse.json();
        
        const uiContainer = document.querySelector('.card');
        patchSelect.style.padding = '10px';
        patchSelect.style.margin = '20px 0';
        patchSelect.style.display = 'block';
        patchSelect.style.width = '100%';
        
        patchSelect.innerHTML = patches.map(p => `<option value="${p}">${p}</option>`).join('');
        
        // Insert dropdown before the console but after the button
        uiContainer.insertBefore(patchSelect, logEl);
        
    } catch (e) {
        log('Failed to load patches.json');
    }
})();
