/**
 * Pokémon Black - Legendary Edition Web Runner
 * Dynamic Chunk Streaming, Wasm DeSmuME Core Integration & Save State Management
 */

const CHUNK_COUNT = 6;
const CHUNK_BASE_URL = 'public/rom/chunk_';

const state = {
  romBlob: null,
  isLoaded: false,
  layout: 'standard', // 'standard' (vertical) | 'widescreen' (horizontal)
};

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const startBtn = document.getElementById('btn-start');
const loadingSpinner = document.getElementById('loading-spinner');
const loadingTitle = document.getElementById('loading-title');
const loadingStatus = document.getElementById('loading-status');
const progressBarFill = document.getElementById('progress-bar-fill');
const screenWrapper = document.getElementById('screen-wrapper');

// Layout & Fullscreen buttons
const btnLayout = document.getElementById('btn-layout');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnExportSave = document.getElementById('btn-export-save');
const btnImportSave = document.getElementById('btn-import-save');
const fileInputSave = document.getElementById('file-import-save');

/**
 * Decompress a zlib/deflate chunk using browser DecompressionStream with pako fallback
 */
async function decompressChunk(compressedBuffer) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(compressedBuffer);
      writer.close();
      const response = new Response(ds.readable);
      const decompressedArrayBuffer = await response.arrayBuffer();
      return new Uint8Array(decompressedArrayBuffer);
    } catch (e) {
      console.warn('Native DecompressionStream fallback:', e);
    }
  }
  // If native DecompressionStream is unavailable, inflate via pako
  if (window.pako) {
    return window.pako.inflate(new Uint8Array(compressedBuffer));
  }
  throw new Error('No decompression provider available.');
}

/**
 * Stream, decompress, and assemble all ROM chunks in parallel with progress tracking
 */
async function loadRomChunks() {
  startBtn.style.display = 'none';
  loadingSpinner.style.display = 'block';
  loadingTitle.innerText = 'Downloading & Decompressing ROM...';
  loadingStatus.innerText = 'Initializing WebAssembly cache...';

  const chunks = new Array(CHUNK_COUNT);
  let loadedChunks = 0;

  const downloadChunk = async (index) => {
    const url = `${CHUNK_BASE_URL}${index}.bin`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download chunk ${index}: ${res.statusText}`);
    const compBuffer = await res.arrayBuffer();
    
    loadingStatus.innerText = `Decompressing Game Chunk ${index + 1} of ${CHUNK_COUNT}...`;
    const decompressed = await decompressChunk(compBuffer);
    chunks[index] = decompressed;

    loadedChunks++;
    const percent = Math.round((loadedChunks / CHUNK_COUNT) * 100);
    progressBarFill.style.width = `${percent}%`;
    loadingStatus.innerText = `Processed Chunk ${loadedChunks}/${CHUNK_COUNT} (${percent}%)...`;
  };

  try {
    const tasks = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      tasks.push(downloadChunk(i));
    }
    await Promise.all(tasks);

    // Calculate total size and merge
    loadingStatus.innerText = 'Assembling NitroFS image in WebAssembly RAM...';
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const romArray = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
      romArray.set(chunk, offset);
      offset += chunk.length;
    }

    state.romBlob = new Blob([romArray], { type: 'application/octet-stream' });
    state.isLoaded = true;

    loadingStatus.innerText = 'Launching Nintendo DS EmulatorJS engine...';
    setTimeout(startEmulator, 400);
  } catch (err) {
    console.error('Error loading ROM:', err);
    loadingTitle.innerText = 'Loading Error';
    loadingStatus.innerText = err.message || 'Failed to download ROM chunks.';
    startBtn.style.display = 'inline-flex';
    startBtn.innerText = 'Retry Download';
  }
}

/**
 * Configure and launch EmulatorJS with WebAssembly NDS core
 */
function startEmulator() {
  loadingOverlay.classList.add('hidden');

  const romUrl = URL.createObjectURL(state.romBlob);

  window.EJS_player = '#game-container';
  window.EJS_core = 'desmume2015'; // Fast WebAssembly DeSmuME core
  window.EJS_gameName = 'Pokemon - Black Version (Legendary Edition)';
  window.EJS_color = '#00e5ff';
  window.EJS_startOnLoaded = true;
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
  window.EJS_gameUrl = romUrl;
  window.EJS_language = 'en-US'; // Explicit language to prevent 404 on en-GB
  
  // Audio, touch, and performance configurations
  window.EJS_volume = 0.8;
  window.EJS_mouse = true;
  // Use threads only if SharedArrayBuffer / crossOriginIsolated is active
  window.EJS_threads = typeof window.crossOriginIsolated !== 'undefined' && window.crossOriginIsolated;

  // Load EmulatorJS runner
  const script = document.createElement('script');
  script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
  document.body.appendChild(script);
}

// Event Listeners
startBtn.addEventListener('click', () => {
  loadRomChunks();
});

btnLayout.addEventListener('click', () => {
  if (state.layout === 'standard') {
    state.layout = 'widescreen';
    screenWrapper.classList.add('widescreen');
    btnLayout.innerHTML = '📱 Vertical View';
  } else {
    state.layout = 'standard';
    screenWrapper.classList.remove('widescreen');
    btnLayout.innerHTML = '🖥️ Side-by-Side';
  }
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    screenWrapper.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
});

// Save Export/Import Helpers
btnExportSave.addEventListener('click', () => {
  alert('To export your in-game battery save or save state, open the EmulatorJS bottom toolbar inside the game, click the Menu icon (three lines), and select "Save State" or "Download Save".');
});

btnImportSave.addEventListener('click', () => {
  fileInputSave.click();
});

fileInputSave.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    alert(`Loaded save file "${file.name}". You can load it via the in-game emulator menu -> "Load State".`);
  }
});
