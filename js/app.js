/**
 * Pokémon Black - Legendary Edition Web Runner
 * IndexedDB ROM caching, streaming decompression, and tuned WebAssembly NDS core.
 */

const CHUNK_COUNT = 6;
const CHUNK_BASE_URL = 'public/rom/chunk_';
const DB_NAME = 'pkmn-legendary-cache';
const DB_STORE = 'rom';
const DB_KEY = 'nds-rom-v1';

const state = {
  romBlob: null,
  layout: 'standard',
};

const loadingOverlay = document.getElementById('loading-overlay');
const startBtn = document.getElementById('btn-start');
const loadingSpinner = document.getElementById('loading-spinner');
const loadingTitle = document.getElementById('loading-title');
const loadingStatus = document.getElementById('loading-status');
const progressBarFill = document.getElementById('progress-bar-fill');
const screenWrapper = document.getElementById('screen-wrapper');

const btnLayout = document.getElementById('btn-layout');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnExportSave = document.getElementById('btn-export-save');
const btnImportSave = document.getElementById('btn-import-save');
const fileInputSave = document.getElementById('file-import-save');

function setProgress(percent, message) {
  progressBarFill.style.width = `${percent}%`;
  if (message) loadingStatus.textContent = message;
}

/* ---------------- IndexedDB ROM cache ---------------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCachedRom() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeCachedRom(blob) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(blob, DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('ROM cache write skipped:', e);
  }
}

/* ---------------- Chunk streaming ---------------- */

// Inflate directly off the network stream so the 256MB image is never buffered twice.
async function fetchChunk(index) {
  const res = await fetch(`${CHUNK_BASE_URL}${index}.bin`);
  if (!res.ok) throw new Error(`Chunk ${index} failed: ${res.statusText}`);

  if (typeof DecompressionStream !== 'undefined' && res.body) {
    const stream = res.body.pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return window.pako.inflate(new Uint8Array(await res.arrayBuffer()));
}

async function downloadRom() {
  const chunks = new Array(CHUNK_COUNT);
  let done = 0;

  await Promise.all(
    Array.from({ length: CHUNK_COUNT }, (_, i) =>
      fetchChunk(i).then((data) => {
        chunks[i] = data;
        done++;
        setProgress(Math.round((done / CHUNK_COUNT) * 90), `Streaming ROM... ${done}/${CHUNK_COUNT}`);
      })
    )
  );

  setProgress(95, 'Assembling NitroFS image...');
  const rom = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    rom.set(chunk, offset);
    offset += chunk.length;
  }
  return new Blob([rom], { type: 'application/octet-stream' });
}

async function loadRom() {
  startBtn.style.display = 'none';
  loadingSpinner.style.display = 'block';
  loadingTitle.textContent = 'Preparing Game';

  try {
    let blob = await readCachedRom();

    if (blob) {
      setProgress(100, 'Loaded from local cache - starting instantly.');
    } else {
      blob = await downloadRom();
      writeCachedRom(blob);
      setProgress(100, 'ROM ready - cached for instant future launches.');
    }

    state.romBlob = blob;
    startEmulator();
  } catch (err) {
    console.error(err);
    loadingTitle.textContent = 'Loading Error';
    loadingStatus.textContent = err.message || 'Failed to download ROM.';
    startBtn.style.display = 'inline-flex';
    startBtn.textContent = 'Retry';
  }
}

/* ---------------- Emulator boot ---------------- */

function startEmulator() {
  loadingOverlay.classList.add('hidden');

  const threaded = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const hwCores = navigator.hardwareConcurrency || 4;

  window.EJS_player = '#game-container';
  window.EJS_core = 'melonds';
  window.EJS_gameName = 'Pokemon - Black Version (Legendary Edition)';
  window.EJS_color = '#00e5ff';
  window.EJS_startOnLoaded = true;
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
  window.EJS_gameUrl = URL.createObjectURL(state.romBlob);
  window.EJS_language = 'en-US';
  window.EJS_volume = 0.7;
  window.EJS_mouse = true;
  window.EJS_threads = threaded;
  window.EJS_disableDatabases = false;
  window.EJS_videoRotation = 0;

  window.EJS_defaultOptions = {
    // Threaded software renderer only pays off when real cores are available.
    melonds_threaded_renderer: threaded && hwCores >= 4 ? 'enabled' : 'disabled',
    melonds_boot_directly: 'enabled',
    melonds_screen_layout: 'Top/Bottom',
    melonds_screen_gap: '0',
    melonds_jit_enable: 'enabled',
    melonds_jit_block_size: '32',
    melonds_jit_branch_optimisations: 'enabled',
    melonds_jit_literal_optimisations: 'enabled',
    melonds_jit_fast_memory: 'enabled',
    melonds_audio_bitrate: '10-bit',
    melonds_audio_interpolation: 'None',
    'audio-latency': '64',
    rewindEnabled: 'disabled',
  };

  const script = document.createElement('script');
  script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
  document.body.appendChild(script);

  // Focus the canvas so key events reach the core directly instead of bubbling the page.
  setTimeout(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (canvas) {
      canvas.setAttribute('tabindex', '0');
      canvas.focus();
    }
  }, 2500);
}

/* ---------------- UI controls ---------------- */

startBtn.addEventListener('click', loadRom);

btnLayout.addEventListener('click', () => {
  const widescreen = state.layout === 'standard';
  state.layout = widescreen ? 'widescreen' : 'standard';
  screenWrapper.classList.toggle('widescreen', widescreen);
  btnLayout.textContent = widescreen ? 'Vertical View' : 'Side-by-Side';
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    screenWrapper.requestFullscreen().catch((err) => alert(`Fullscreen error: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
});

btnExportSave.addEventListener('click', () => {
  alert('Open the emulator toolbar at the bottom of the screen, click the menu icon, then choose "Save State" or "Download Save".');
});

btnImportSave.addEventListener('click', () => fileInputSave.click());

fileInputSave.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    alert(`Selected "${file.name}". Load it from the emulator toolbar menu -> "Load State".`);
  }
});
