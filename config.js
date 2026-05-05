'use strict';
/* ═══════════════════════════════════════════════════════════
   MOSAIC — config.js
   Shared constants, data, save system, audio. No dependencies.
   ═══════════════════════════════════════════════════════════ */

const TOTAL_LEVELS  = 350;
const TRIANGLE_MAX  = 6;
const MASTER_UNLOCK = 50;
const MASTER_LEVELS = 20;
const SHAPES        = ['square', 'rectangle', 'triangle', 'jigsaw'];
const GAP           = 0;       // zero gap — seamless puzzle
const DEBUG         = false;
const FALLBACK_IMAGE = `url('https://picsum.photos/id/1/400/400')`;

// ─── LEVELS ──────────────────────────────────────────────
// Picsum seeds: each level gets its own unique seed → unique image.
// picsum.photos/seed/{seed}/800/800 is deterministic (same seed = same image)
// and has thousands of distinct photos, so no repeats across 350 levels.
const LOCAL_ASSETS = [
  'assets/levels/media__1776434033947.jpg',
  'assets/levels/media__1776434034979.jpg',
  'assets/levels/media__1776434035548.jpg',
  'assets/levels/media__1776434036559.jpg'
];

// ─── MILESTONE INDICES ────────────────────────────────────
// Levels 10, 20, 50, 100, 150, 200, 250, 300, 350 are milestone levels.
// They spike +1 in grid size and carry difficulty:'milestone'.
const MILESTONE_LEVELS = new Set([9, 19, 49, 99, 149, 199, 249, 299, 349]);

const LEVELS = Array.from({ length: TOTAL_LEVELS }, (_, i) => {
  const n = i + 1;

  // Smooth base-size curve — most levels stay in comfortable 3–6 range.
  // Climbs slowly: ~35 levels at size 3, then long stretches at 4, 5, 6.
  // Sizes 7–9 are reserved for late-game and milestones only.
  let g;
  if      (n <= 10)  g = 3;                  // Tutorial: all 3×3
  else if (n <= 25)  g = 4;                  // Beginner: all 4×4
  else if (n <= 50)  g = n % 5 === 0 ? 5 : 4; // Beginner+: mostly 4, touch of 5
  else if (n <= 80)  g = 5;                  // Casual: all 5×5
  else if (n <= 110) g = n % 5 === 0 ? 6 : 5; // Casual+: mostly 5, touch of 6
  else if (n <= 150) g = 6;                  // Intermediate: all 6×6
  else if (n <= 190) g = n % 5 === 0 ? 7 : 6; // Intermediate+: mostly 6
  else if (n <= 230) g = 7;                  // Advanced
  else if (n <= 270) g = n % 5 === 0 ? 8 : 7; // Advanced+
  else if (n <= 310) g = 8;                  // Expert
  else               g = n % 5 === 0 ? 9 : 8; // Expert+

  // Milestone spike: bump base size by 1 (capped at 9)
  const isMilestone = MILESTONE_LEVELS.has(i);
  if (isMilestone) g = Math.min(g + 1, 9);

  let imgStr;
  if (i < LOCAL_ASSETS.length) {
    imgStr = `url('${LOCAL_ASSETS[i]}')`;
  } else {
    imgStr = `url('https://picsum.photos/seed/${i + 100}/800/800')`;
  }
  return { size: g, difficulty: isMilestone ? 'milestone' : 'normal', image: imgStr };
});

// -- LEVEL VALIDATION (startup) --------------------------
// Runs once immediately so the LEVELS array is always clean.
(function _patchLevels() {
  const MIN_SIZE = 3, MAX_SIZE = 9;
  let patched = 0;
  LEVELS.forEach((lvl, i) => {
    if (typeof lvl.image !== 'string' || lvl.image.trim().length < 5) {
      console.warn(`[CONFIG] LEVELS[${i}] image missing - using fallback`);
      lvl.image = FALLBACK_IMAGE;
      patched++;
    }
    const origSize = lvl.size;           // capture BEFORE overwrite
    const s = parseInt(lvl.size, 10);
    if (!Number.isFinite(s) || s < MIN_SIZE || s > MAX_SIZE) {
      console.warn(`[CONFIG] LEVELS[${i}] size "${origSize}" invalid - using ${MIN_SIZE}`);
      lvl.size = MIN_SIZE;
      patched++;
    } else {
      lvl.size = s;   // normalise to integer
    }
  });
  if (patched)
    console.info(`[CONFIG] _patchLevels: ${patched} corrections across ${LEVELS.length} levels`);
})();


// ─── SAVE ────────────────────────────────────────────────
const Save = {
  KEY: 'mosaic_v2', data: null,
  defaults: () => ({
    username:   null,
    progress:   { square: 0, rectangle: 0, triangle: 0, jigsaw: 0 },
    bestTimes:  {},
    bestStars:  {},   // best star rating per level key (e.g. 'square_0')
    totalCoins: 0,    // lifetime coins earned
    settings:   { sound: true, haptic: true, bgm: false },
    following: [], likedPuzzles: [], daily: {}, masterDone: [],
  }),
  load() {
    try {
      const r = localStorage.getItem(this.KEY);
      if (!r) { this.data = this.defaults(); return; }
      const saved = JSON.parse(r);
      const def   = this.defaults();
      // Deep-merge: top-level primitives from saved win; nested objects merged
      // key-by-key so newly added default keys survive across app updates.
      this.data = {
        ...def,
        ...saved,
        settings:     { ...def.settings,     ...(saved.settings     || {}) },
        progress:     { ...def.progress,      ...(saved.progress     || {}) },
        daily:        { ...(saved.daily       || {}) },
        masterDone:   Array.isArray(saved.masterDone)   ? saved.masterDone   : [],
        likedPuzzles: Array.isArray(saved.likedPuzzles) ? saved.likedPuzzles : [],
        following:    Array.isArray(saved.following)    ? saved.following    : [],
        // Coin & star system — explicit type guards survive data corruption on upgrade
        totalCoins:   Number.isFinite(saved.totalCoins) ? Math.max(0, saved.totalCoins) : 0,
        bestStars:    (saved.bestStars && typeof saved.bestStars === 'object' && !Array.isArray(saved.bestStars))
                        ? { ...saved.bestStars } : {},
      };
    } catch { this.data = this.defaults(); }
  },
  flush() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch {} },
  totalSolved() { return SHAPES.reduce((s, sh) => s + (this.data.progress[sh] || 0), 0); },
};

// ─── AUDIO ───────────────────────────────────────────────
const Audio = {
  ctx: null, bgmGain: null, bgmNodes: [], bgmPlaying: false,
  _bgmTimer: null, _bgmPad: null,

  init() {
    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = 0.08;
        this.bgmGain.connect(this.ctx.destination);
      }
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
  },

  play(type) {
    if (!Save.data.settings.sound || !this.ctx) return;
    const now = this.ctx.currentTime;
    const sfx = {
      drag:  [[400, .06, .08]],
      swap:  [[660, .12, .12], [880, .08, .1]],
      group: [[523, .14, .25], [659, .1, .2], [784, .08, .18]],
      win:   [[523, .2, .6], [659, .18, .55], [784, .15, .5], [1047, .12, .45]],
    };
    (sfx[type] || []).forEach(([f, v, d]) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.connect(g); g.connect(this.ctx.destination);
      o.type = type === 'win' ? 'sine' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(v, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + d);
      o.start(now); o.stop(now + d);
    });
  },

  startBGM() {
    if (!this.ctx || this.bgmPlaying) return;
    this.bgmPlaying = true;
    const notes = [261.63, 329.63, 392, 523.25, 392, 329.63]; let idx = 0;
    const tick = () => {
      if (!this.bgmPlaying) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = notes[idx++ % notes.length];
      g.gain.setValueAtTime(0, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(.06, this.ctx.currentTime + .3);
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2.5);
      o.connect(g); g.connect(this.bgmGain);
      o.start(this.ctx.currentTime); o.stop(this.ctx.currentTime + 2.8);
      this._bgmTimer = setTimeout(tick, 2200 + Math.random() * 600);
    };
    tick();
    const p = this.ctx.createOscillator(), pg = this.ctx.createGain();
    p.type = 'sine'; p.frequency.value = 130.81; pg.gain.value = .03;
    p.connect(pg); pg.connect(this.bgmGain); p.start();
    this._bgmPad = p;
  },

  stopBGM() {
    this.bgmPlaying = false;
    clearTimeout(this._bgmTimer);
    this.bgmNodes.forEach(n => { try { n.stop(); } catch {} });
    this.bgmNodes = [];
    if (this._bgmPad) { try { this._bgmPad.stop(); } catch {} this._bgmPad = null; }
  },

  toggleBGM() { this.bgmPlaying ? this.stopBGM() : this.startBGM(); return this.bgmPlaying; },
};

function haptic(ms = 10) {
  if (Save.data.settings.haptic && navigator.vibrate) navigator.vibrate(ms);
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── IMAGE CACHE ─────────────────────────────────────────
// LRU map keyed by `url|ratio`. Stores preloadImage() results so
// replays and Next-Level skips are instant without re-fetching.
// Cap at 30 entries to stay mobile-memory-friendly.
const ImageCache = (() => {
  const MAX = 30;
  const _map = new Map();
  return {
    has(key)      { return _map.has(key); },
    get(key) {
      if (!_map.has(key)) return null;
      const v = _map.get(key);
      _map.delete(key); _map.set(key, v); // bump to MRU end
      return v;
    },
    set(key, val) {
      if (_map.has(key)) _map.delete(key);
      if (_map.size >= MAX) _map.delete(_map.keys().next().value); // evict LRU
      _map.set(key, val);
    },
    clear()  { _map.clear(); },
    size()   { return _map.size; },
  };
})();
