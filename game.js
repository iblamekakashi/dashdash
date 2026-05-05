'use strict';
/* ═══════════════════════════════════════════════════════════
   MOSAIC — game.js
   Pure puzzle engine: generation · rendering · drag · swap ·
   grouping · win detection.
   NO navigation, NO social, NO profile rendering.
   Depends on: config.js (LEVELS, SHAPES, Save, Audio, haptic, fmtTime, DEBUG…)
   Calls into UI via: openModal(), closeModal(), showToast(), spawnConfetti()
   (defined in ui.js, loaded after this file)
   ═══════════════════════════════════════════════════════════ */

// ─── TIMER ───────────────────────────────────────────────
const Timer = {
  startMs: 0, elapsed: 0, rafId: null, running: false, started: false,

  start() {
    if (this.running) return;
    this.startMs = Date.now() - this.elapsed;
    this.running = true; this.started = true; this._tick();
  },
  pause() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  },
  reset()      { this.pause(); this.elapsed = 0; this.started = false; this._render(0); },
  startIfFirst(){ if (!this.started) this.start(); },
  _tick() {
    if (!this.running) return;
    this.elapsed = Date.now() - this.startMs;
    this._render(this.elapsed);
    this.rafId = requestAnimationFrame(() => this._tick());
  },
  _render(ms) {
    const el = document.getElementById('game-timer');
    if (el) el.textContent = fmtTime(ms);
  },
  display() { return fmtTime(this.elapsed); },
};

// ─── GAME STATE ──────────────────────────────────────────
// G is the single source of truth for the active puzzle.
// It is ONLY written by startGame() and the swap/drag engine.
// UI and Social modules read G but never write it.
let G = {};
let dragState = null, dragRafId = null, prevGroupCount = 0;
let moveCount  = 0;   // incremented on each successful swap; reset by startGame()

// ─── UTILITIES ───────────────────────────────────────────

/** Derangement shuffle: no element stays at its original index.
 *  Uses a full Knuth (Fisher-Yates) shuffle then repairs ALL fixed
 *  points by swapping each one with its neighbour (wrapping).
 *  The previous version used range [0, i) which biased the shuffle
 *  and only repaired index 0, leaving other fixed points intact.
 */
function derangeShuffle(n) {
  if (n <= 1) return [0];
  const arr = Array.from({ length: n }, (_, i) => i);
  // Full Knuth shuffle — j in [0, i] so every element can reach every position
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Repair ALL fixed points, not just index 0
  for (let i = 0; i < n; i++) {
    if (arr[i] === i) {
      const k = (i + 1) % n;   // swap with next neighbour (wraps)
      [arr[i], arr[k]] = [arr[k], arr[i]];
    }
  }
  return arr;
}

// ─── TRIANGLE POSITION-TYPE SYSTEM ───────────────────────
// Each cell in a triangle grid has a "parity" determined by the
// checkerboard formula: (col + row) % 2.
//   parity 0 → tri-a = tri-tl (↖),  tri-b = tri-br (↘)
//   parity 1 → tri-a = tri-tr (↗),  tri-b = tri-bl (↙)
//
// RULE: a triangle piece may only occupy cells of the SAME parity
// as its home cell.  This means:
//   - tri-tl can only move to parity-0 cells  (stays a top-left triangle)
//   - tri-tr can only move to parity-1 cells  (stays a top-right triangle)
//   - etc.
// This prevents visual inversion / rotation of pieces.

/** Checkerboard parity for a flat slot index. */
function triParity(slot, cols) {
  return (Math.floor(slot / cols) + (slot % cols)) % 2;
}

/**
 * Derange a group of slot indices among themselves.
 * Returns a new array that is a shuffled (deranged) version of `slots`
 * where no element lands on its own original index within the group.
 */
function _derangeGroup(slots) {
  const n = slots.length;
  if (n <= 1) return [...slots];
  // Fisher-Yates shuffle
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));   // j in [0, i] — full Knuth shuffle
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // Sweep: repair ALL fixed points (perm[i] === i), not just index 0.
  // Any fixed point at position i is swapped with a neighbouring index
  // (wrapping) so the result is always a true derangement.
  for (let i = 0; i < n; i++) {
    if (perm[i] === i) {
      const j = (i + 1) % n;   // swap with next (wraps around)
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }
  return perm.map(i => slots[i]);
}

/**
 * Parity-constrained derangement shuffle for triangle grids.
 * Even-parity slots shuffle among even-parity slots only.
 * Odd-parity  slots shuffle among odd-parity  slots only.
 * Guarantees each piece always starts on a cell of the same visual
 * orientation type as its home cell.
 */
function derangeShuffleTriangle(total, cols) {
  const evenSlots = [], oddSlots = [];
  for (let i = 0; i < total; i++) {
    (triParity(i, cols) === 0 ? evenSlots : oddSlots).push(i);
  }
  const evenShuffled = _derangeGroup(evenSlots);
  const oddShuffled  = _derangeGroup(oddSlots);

  const result = new Array(total);
  evenSlots.forEach((homeSlot, idx) => { result[homeSlot] = evenShuffled[idx]; });
  oddSlots .forEach((homeSlot, idx) => { result[homeSlot] = oddShuffled[idx];  });
  return result;
}


/** Generate absolute bezier path for a smooth jigsaw mask. */
function getJigsawPath(pw, ph, pad, t, r, b, l) {
  const K = Math.min(pw, ph) * 0.22;
  const cw = pw / 2;
  const ch = ph / 2;
  
  let d = `M ${pad} ${pad} `;
  if (t === 0) d += `L ${pad + pw} ${pad} `;
  else {
    const sign = t > 0 ? -1 : 1;
    d += `L ${pad + cw - K} ${pad} `;
    d += `C ${pad + cw - K} ${pad + sign * pad * 0.8}, ${pad + cw - K*1.8} ${pad + sign * pad}, ${pad + cw} ${pad + sign * pad} `;
    d += `C ${pad + cw + K*1.8} ${pad + sign * pad}, ${pad + cw + K} ${pad + sign * pad * 0.8}, ${pad + cw + K} ${pad} `;
    d += `L ${pad + pw} ${pad} `;
  }
  
  if (r === 0) d += `L ${pad + pw} ${pad + ph} `;
  else {
    const sign = r > 0 ? 1 : -1;
    d += `L ${pad + pw} ${pad + ch - K} `;
    d += `C ${pad + pw + sign * pad * 0.8} ${pad + ch - K}, ${pad + pw + sign * pad} ${pad + ch - K*1.8}, ${pad + pw + sign * pad} ${pad + ch} `;
    d += `C ${pad + pw + sign * pad} ${pad + ch + K*1.8}, ${pad + pw + sign * pad * 0.8} ${pad + ch + K}, ${pad + pw} ${pad + ch + K} `;
    d += `L ${pad + pw} ${pad + ph} `;
  }
  
  if (b === 0) d += `L ${pad} ${pad + ph} `;
  else {
    const sign = b > 0 ? 1 : -1;
    d += `L ${pad + cw + K} ${pad + ph} `;
    d += `C ${pad + cw + K} ${pad + ph + sign * pad * 0.8}, ${pad + cw + K*1.8} ${pad + ph + sign * pad}, ${pad + cw} ${pad + ph + sign * pad} `;
    d += `C ${pad + cw - K*1.8} ${pad + ph + sign * pad}, ${pad + cw - K} ${pad + ph + sign * pad * 0.8}, ${pad + cw - K} ${pad + ph} `;
    d += `L ${pad} ${pad + ph} `;
  }
  
  if (l === 0) d += `L ${pad} ${pad} `;
  else {
    const sign = l > 0 ? -1 : 1;
    d += `L ${pad} ${pad + ch + K} `;
    d += `C ${pad + sign * pad * 0.8} ${pad + ch + K}, ${pad + sign * pad} ${pad + ch + K*1.8}, ${pad + sign * pad} ${pad + ch} `;
    d += `C ${pad + sign * pad} ${pad + ch - K*1.8}, ${pad + sign * pad * 0.8} ${pad + ch - K}, ${pad} ${pad + ch - K} `;
    d += `L ${pad} ${pad} `;
  }
  return d + "Z";
}

/** Compute integer piece/container dimensions that avoid sub-pixel gaps. */
function computeSize(cols, rows, shape) {
  let pw, ph;

  if (shape === 'rectangle') {
    // Fixed board target: 370×550px across all rectangle grid sizes.
    // pw and ph are derived independently from the board target ÷ grid dimensions,
    // so every grid fills exactly that space regardless of cols/rows count.
    // A responsive safety clamp (95vw / 80vh) prevents overflow on very small screens.
    const targetW = Math.min(370, Math.floor(window.innerWidth  * 0.95));
    const targetH = Math.min(550, Math.floor(window.innerHeight * 0.80));
    pw = Math.floor(targetW / cols);
    ph = Math.floor(targetH / rows);
  } else {
    // Square / Triangle / Jigsaw — unchanged original sizing
    const maxW = Math.floor(Math.min(window.innerWidth * 0.88, 360));
    pw = Math.floor(maxW / cols);
    ph = Math.floor(maxW / rows);
  }

  return { pieceW: pw, pieceH: ph, containerW: pw * cols, containerH: ph * rows };
}


function buildSlots(cols, rows, pw, ph) {
  return Array.from({ length: cols * rows }, (_, i) => ({
    x: (i % cols) * pw,
    y: Math.floor(i / cols) * ph,
  }));
}

// ─── TRIANGLE GRID ────────────────────────────────────
// Each cell in the grid is split by ONE consistent diagonal: "\"
//   tri-upper = upper-right triangle ◥ (above the \ diagonal)
//   tri-lower = lower-left  triangle ◣ (below the \ diagonal)
// The two halves of each cell are ALWAYS the same shape.
// No alternating, no parity, no rotation.
function getSubTypes(shape) { return shape === 'triangle' ? ['tri-upper', 'tri-lower'] : ['solid']; }

// ─── MOVE COUNTER · HUD HELPERS ──────────────────────────
/** Update the in-game move counter display. */
function _updateMovesHUD() {
  const el = document.getElementById('game-moves');
  if (el) el.textContent = moveCount + (moveCount === 1 ? ' move' : ' moves');
}

/** Refresh the coin balance shown in both the game HUD and the home-screen pill. */
function _updateCoinHUD() {
  const coins = Save.data.totalCoins || 0;
  const gameEl = document.getElementById('hud-coins');
  if (gameEl) gameEl.textContent = '\uD83E\uDE99 ' + coins;
  const homeEl = document.getElementById('home-coins');
  if (homeEl) homeEl.textContent = '\uD83E\uDE99 ' + coins;
}

/**
 * Shape-aware star rating — combines move efficiency with a time bonus.
 *
 * Base move budget = cols × rows × shapeMultiplier
 *   3 ★  moves ≤ budget × 1.4  AND time under timeBudget (8s per piece)
 *   2 ★  moves ≤ budget × 2.4  (achievable by any reasonable player)
 *   1 ★  anything above
 *
 * Time only affects the 3-star boundary — you can never lose 2 stars
 * purely from being slow, keeping the game relaxed.
 *
 * shape multipliers (higher = more lenient thresholds):
 *   square    → 1.0   rectangle → 1.2
 *   triangle  → 1.5   jigsaw    → 1.7
 */
const SHAPE_DIFFICULTY = { square: 1.0, rectangle: 1.2, triangle: 1.5, jigsaw: 1.7 };

function calculateStars(moves, cols, rows, shape, elapsedMs = 0) {
  const mult    = SHAPE_DIFFICULTY[shape] ?? 1.0;
  const pieces  = cols * rows;
  const budget  = Math.ceil(pieces * mult);           // baseline move budget

  // Time budget: 8 s per piece — relaxed so casual players aren't penalised
  const timeBudgetMs = pieces * 8 * 1000;
  const overTimeSec  = Math.max(0, (elapsedMs - timeBudgetMs) / 1000);

  // 3-star: tight moves AND not massively over-time (each 30 s over = +1 effective move)
  const effectiveMoves3 = moves + Math.floor(overTimeSec / 30);
  if (effectiveMoves3 <= Math.ceil(budget * 1.4)) return 3;

  // 2-star: purely move-based — time never locks you out of progression
  if (moves <= Math.ceil(budget * 2.4)) return 2;

  return 1;
}

// ─── GRID MATRIX ─────────────────────────────────────────
function buildMatrix() {
  G.gridMatrix = {};
  getSubTypes(G.shape).forEach(sub => { G.gridMatrix[sub] = new Array(G.cols * G.rows).fill(null); });
  G.pieces.forEach(p => { G.gridMatrix[p.subType][p.currentSlot] = p.id; });
}
function matrixSet(sub, slot, id) { if (G.gridMatrix?.[sub]) G.gridMatrix[sub][slot] = id; }
function matrixGet(sub, slot)     { return G.gridMatrix?.[sub]?.[slot] ?? null; }

// ─── PIECE STYLING — seamless, zero-gap, pixel-perfect ───
function applyPieceStyle(piece) {
  const { inner, homeSlot, subType } = piece;
  const { shape, cols, containerW, containerH, pieceW, pieceH, image, imageMeta } = G;

  // bx/by: which puzzle-grid pixel offset this piece's home slot corresponds to.
  const bx = (homeSlot % cols) * pieceW;
  const by = Math.floor(homeSlot / cols) * pieceH;

  // ── CSS background parameters ──────────────────────────
  // canvas-encoded (external/uploaded): image is already containerW×containerH px.
  // local asset: imageMeta provides bgW/bgH/bgOffX/bgOffY for CSS center-crop.
  let bgW, bgH, bgOffX, bgOffY;
  if (imageMeta) {
    ({ bgW, bgH, bgOffX, bgOffY } = imageMeta);
  } else {
    bgW = containerW; bgH = containerH; bgOffX = 0; bgOffY = 0;
  }

  if (shape === 'jigsaw') {
    const pad = Math.round(pieceW * 0.25);
    Object.assign(inner.style, {
      top:  -pad + 'px', left: -pad + 'px',
      width:  (pieceW + 2 * pad) + 'px',
      height: (pieceH + 2 * pad) + 'px',
      backgroundImage: image,
      backgroundSize: `${bgW + 2 * pad}px ${bgH + 2 * pad}px`,
      backgroundPosition: `${bgOffX - bx + pad}px ${bgOffY - by + pad}px`,
    });
    inner.style.clipPath = `url(#jigsaw-clip-${piece.id})`;
    inner.style.webkitClipPath = `url(#jigsaw-clip-${piece.id})`;
    if (piece.wrap) piece.wrap.style.overflow = 'visible';

  } else if (shape === 'triangle') {
    inner.className = `piece-inner ${subType}`;
    inner.style.touchAction = 'none';
    inner.style.userSelect  = 'none';
    Object.assign(inner.style, {
      top: '0px', left: '0px',
      width:  pieceW + 'px',
      height: pieceH + 'px',
      backgroundImage:    image,
      backgroundSize:     `${bgW}px ${bgH}px`,
      backgroundPosition: `${bgOffX - bx}px ${bgOffY - by}px`,
      border: 'none', outline: 'none', boxShadow: 'none',
    });

  } else {
    // Square / Rectangle
    Object.assign(inner.style, {
      top:  '0px', left: '0px',
      width:  pieceW + 'px',
      height: pieceH + 'px',
      backgroundImage:    image,
      backgroundSize:     `${bgW}px ${bgH}px`,
      backgroundPosition: `${bgOffX - bx}px ${bgOffY - by}px`,
      boxSizing: 'border-box',
      borderStyle: 'solid',
      borderColor: 'rgba(15,15,20,0.85)',
      outline: 'none', boxShadow: 'none',
    });
  }
}


function createPieceEl(piece) {
  const isTriangle = G.shape === 'triangle';
  const wrap = document.createElement('div');
  wrap.className  = 'piece-wrap';
  // Triangle: overflow:hidden so clip-path edge is crisp; pointer-events:none so
  // only the visible inner triangle area captures touches (set on inner below).
  wrap.style.cssText = [
    `width:${G.pieceW}px`,
    `height:${G.pieceH}px`,
    isTriangle ? 'overflow:hidden' : 'overflow:visible',
    isTriangle ? 'pointer-events:none' : 'pointer-events:auto',
  ].join(';') + ';';
  wrap.dataset.pid = piece.id;

  const inner = document.createElement('div');
  inner.className  = 'piece-inner';
  inner.style.cssText = `pointer-events:${isTriangle ? 'auto' : 'none'};touch-action:none;user-select:none;image-rendering:auto;`;
  wrap.appendChild(inner);

  piece.wrap = wrap; piece.inner = inner;
  applyPieceStyle(piece);
  
  const target = isTriangle ? inner : wrap;
  target.addEventListener('pointerdown', e => _onPointerDown(e, piece));
  return wrap;
}

function positionPiece(p) {
  const s = G.slots[p.currentSlot];
  // Use translate3d so the compositor handles all movement —
  // left/top are fixed at 0 and never change after this.
  p.wrap.style.left      = '0';
  p.wrap.style.top       = '0';
  p.wrap.style.transition = 'none';
  p.wrap.style.transform = `translate3d(${s.x}px,${s.y}px,0)`;
}

// ─── BUILD GRID ──────────────────────────────────────────
// Only touches elements inside #puzzle-grid. Isolated from other screens.
function buildGrid() {
  const grid = document.getElementById('puzzle-grid');
  grid.innerHTML  = '';
  grid.className  = 'puzzle-grid';
  grid.style.width  = G.containerW + 'px';
  grid.style.height = G.containerH + 'px';
  // No background image: prevents the solved image from bleeding through piece gaps
  grid.style.backgroundImage = 'none';

  if (G.shape === 'jigsaw') {
    const svgNS = "http://www.w3.org/2000/svg";
    const svgel = document.createElementNS(svgNS, 'svg');
    svgel.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
    const defs = document.createElementNS(svgNS, 'defs');
    
    const pad = Math.round(G.pieceW * 0.25);
    G.pieces.forEach(p => {
       const cp = document.createElementNS(svgNS, 'clipPath');
       cp.id = `jigsaw-clip-${p.id}`;
       const path = document.createElementNS(svgNS, 'path');
       
       const r = Math.floor(p.homeSlot / G.cols), c = p.homeSlot % G.cols;
       const t = r === 0 ? 0 : -(G.hEdges[r-1][c] || 0);
       const right = c === G.cols - 1 ? 0 : (G.vEdges[r][c] || 0);
       const b = r === G.rows - 1 ? 0 : (G.hEdges[r][c] || 0);
       const l = c === 0 ? 0 : -(G.vEdges[r][c-1] || 0);
       
       path.setAttribute('d', getJigsawPath(G.pieceW, G.pieceH, pad, t, right, b, l));
       cp.appendChild(path);
       defs.appendChild(cp);
    });
    svgel.appendChild(defs);
    grid.appendChild(svgel);
  }

  if (DEBUG) {
    grid.classList.add('debug-mode');
    grid.style.setProperty('--debug-cell-w', G.pieceW + 'px');
    grid.style.setProperty('--debug-cell-h', G.pieceH + 'px');
  }

  const overlay = document.createElement('div');
  overlay.className = 'win-overlay';
  overlay.style.backgroundImage = G.image;
  if (G.imageMeta) {
    // Local asset: apply same CSS center-crop to the win overlay
    const { bgW, bgH, bgOffX, bgOffY } = G.imageMeta;
    overlay.style.backgroundSize     = `${bgW}px ${bgH}px`;
    overlay.style.backgroundPosition = `${bgOffX}px ${bgOffY}px`;
  } else {
    overlay.style.backgroundSize     = `${G.containerW}px ${G.containerH}px`;
    overlay.style.backgroundPosition = '0 0';
  }
  grid.appendChild(overlay);

  G.pieces.forEach(p => { grid.appendChild(createPieceEl(p)); positionPiece(p); });
}

// ─── LEVEL VALIDATOR ─────────────────────────────────────
// Checks every parameter before any game state is mutated.
// Returns a clean, guaranteed-safe config object.
// Safe defaults: shape=square, size=3, image=FALLBACK_IMAGE.
function _validateGameConfig(cfg) {
  const SAFE = { shape: 'square', size: 3, image: FALLBACK_IMAGE };
  const reasons = [];

  // ── 1. Shape check ───────────────────────────────────────
  let shape = cfg.shape;
  if (!shape || !SHAPES.includes(shape)) {
    reasons.push(`invalid shape "${shape}"`);
    shape = SAFE.shape;
  }

  // ── 2. Level index check ──────────────────────────────────
  let level = cfg.level ?? 0;
  if (!Number.isFinite(level) || level < 0) {
    reasons.push(`invalid level "${level}"`);
    level = 0;
  }
  level = Math.min(Math.floor(level), LEVELS.length - 1);

  // ── 3. Image resolution ───────────────────────────────────
  // For campaign levels: pull from LEVELS array and verify the entry exists.
  // For custom: caller supplies the image string directly.
  let image, baseSize, isCustom = false;

  if (cfg.customCfg) {
    isCustom = true;
    const cc = cfg.customCfg;

    // Image: must be a non-empty string that looks like a CSS url() or data URI
    image = (typeof cc.image === 'string' && cc.image.trim().length > 4)
      ? cc.image.trim()
      : null;
    if (!image) {
      reasons.push('custom image missing or invalid');
      image = SAFE.image;
    }

    // Size: must be an integer in [3, 9]
    baseSize = parseInt(cc.size, 10);
    if (!Number.isFinite(baseSize) || baseSize < 3 || baseSize > 9) {
      reasons.push(`custom size "${cc.size}" out of range [3,9]`);
      baseSize = SAFE.size;
    }

    // Shape override from customCfg
    const cs = cc.shape;
    if (cs && SHAPES.includes(cs)) shape = cs;

  } else {
    // Campaign level
    const lvlEntry = LEVELS[level];
    if (!lvlEntry) {
      reasons.push(`LEVELS[${level}] undefined`);
      image    = SAFE.image;
      baseSize = SAFE.size;
      shape    = SAFE.shape;
    } else {
      image    = (typeof lvlEntry.image === 'string' && lvlEntry.image.trim().length > 4)
        ? lvlEntry.image.trim()
        : SAFE.image;
      if (image === SAFE.image) reasons.push(`LEVELS[${level}].image missing`);

      baseSize = parseInt(lvlEntry.size, 10);
      if (!Number.isFinite(baseSize) || baseSize < 3 || baseSize > 9) {
        reasons.push(`LEVELS[${level}].size "${lvlEntry.size}" invalid`);
        baseSize = SAFE.size;
      }
    }
  }

  // ── 4. Shape × size compatibility ────────────────────────
  // Triangle is only supported up to TRIANGLE_MAX × TRIANGLE_MAX
  if (shape === 'triangle' && baseSize > TRIANGLE_MAX) {
    reasons.push(`triangle incompatible with size ${baseSize} (max ${TRIANGLE_MAX})`);
    shape = 'square';
  }

  // -- 5. Piece count sanity ---------------------------------
  // Rectangle has one extra row; triangle has 2 sub-layers (tri-a + tri-b).
  const cols = baseSize;
  const rows = shape === 'rectangle' ? baseSize + 1 : baseSize;
  const totalPieces = (shape === 'triangle' ? 2 : 1) * cols * rows;
  // Minimum valid puzzle: 2×2 square = 4 pieces. Maximum: 9×10 rectangle = 90.
  // Upper bound 1000 guards against absurd customCfg values.
  if (totalPieces < 4 || totalPieces > 1000) {
    reasons.push(`piece count ${totalPieces} out of safe range [4, 1000]`);
    shape = SAFE.shape; baseSize = SAFE.size; image = SAFE.image;
  }

  // ── 6. Report ─────────────────────────────────────────────
  if (reasons.length) {
    const msg = `[PUZZLE] Fallback applied — ${reasons.join('; ')}`;
    console.warn(msg);
    // Only show a toast for the first failure (avoid toast-spam on fast level skips)
    if (typeof showToast === 'function') {
      showToast('⚠️ Level auto-corrected — loading safe defaults', '#f5a623');
    }
  }

  return { shape, level, image, baseSize, isCustom, levelShape: cfg.shape || shape };
}

/**
 * Hybrid image preloader.
 *
 * LOCAL assets (relative paths — e.g. assets/levels/*.jpg):
 *   → load via Image() to get natural dimensions, return raw URL.
 *     No canvas, no re-encoding, no CORS header needed.
 *     Aspect-ratio cropping is handled in CSS by applyPieceStyle()
 *     using the `natural` dimensions returned here.
 *
 * EXTERNAL / cross-origin / data URIs:
 *   → existing canvas crop + JPEG re-encode path, unchanged.
 *
 * Both paths cache into ImageCache (keyed by url+ratio) so replays
 * and "Next Level" skips are instant.
 */
function preloadImage(url, timeoutMs = 8000, targetRatio = 1) {
  return new Promise(resolve => {
    // ── Cache hit ──────────────────────────────────────────
    const cacheKey = url + '|' + targetRatio.toFixed(4);
    if (ImageCache.has(cacheKey)) {
      return resolve(ImageCache.get(cacheKey));
    }

    // ── Local asset detection ──────────────────────────────
    // A URL is "local" when it is a relative path (no scheme).
    // Same-origin local files load instantly from disk/SW cache.
    const isLocal = !/^(https?:|data:)/i.test(url.trim());

    let settled = false;
    const img = new Image();
    if (!isLocal) img.crossOrigin = 'Anonymous';

    // External-only timeout — local loads are instant
    const timer = isLocal ? null : setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[PUZZLE] Image preload timed out (${timeoutMs}ms):`, url);
        resolve({ success: false });
      }
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      if (!img.width || !img.height) {
        console.warn('[PUZZLE] Image has 0 dimensions:', url);
        return resolve({ success: false });
      }

      if (isLocal) {
        // ── Local path: return raw URL + natural dims ──────
        // applyPieceStyle() will compute the correct CSS
        // background-size / background-position to center-crop
        // the image to the puzzle's aspect ratio without canvas.
        const result = { success: true, url, natural: { w: img.width, h: img.height } };
        ImageCache.set(cacheKey, result);
        return resolve(result);
      }

      // ── External path: canvas center-crop + JPEG encode ─
      try {
        const imgRatio = img.width / img.height;
        let sW = img.width, sH = img.height, sX = 0, sY = 0;
        if (imgRatio > targetRatio) {
          sW = img.height * targetRatio;
          sX = (img.width - sW) / 2;
        } else {
          sH = img.width / targetRatio;
          sY = (img.height - sH) / 2;
        }

        const canvas = document.createElement('canvas');
        const maxDim = 800;
        if (targetRatio >= 1) {
          canvas.width  = maxDim;
          canvas.height = Math.round(maxDim / targetRatio);
        } else {
          canvas.height = maxDim;
          canvas.width  = Math.round(maxDim * targetRatio);
        }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sX, sY, sW, sH, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const result = { success: true, url: dataUrl };
        ImageCache.set(cacheKey, result);
        resolve(result);
      } catch (e) {
        console.warn('[PUZZLE] Canvas crop failed (tainted?):', e);
        resolve({ success: false });
      }
    };

    img.onerror = () => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        console.warn('[PUZZLE] Image load error:', url);
        resolve({ success: false });
      }
    };

    img.src = url;
  });
}

// ─── LOADING UI ──────────────────────────────────────────
/** Show a non-blocking loading overlay inside .game-stage while the image loads. */
function _showGameLoading() {
  const stage = document.querySelector('.game-stage');
  if (!stage) return;
  _hideGameLoading();
  const el = document.createElement('div');
  el.id = 'game-loading-overlay';
  el.className = 'game-loading-overlay';
  el.innerHTML = '<div class="game-loading-spinner"></div><p class="game-loading-text">Loading…</p>';
  stage.appendChild(el);
}

/** Remove the loading overlay with a quick fade. */
function _hideGameLoading() {
  const el = document.getElementById('game-loading-overlay');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 280);
}

/**
 * Silently prefetch the next campaign level's image into ImageCache
 * so that pressing "Next Level" feels instant.
 * Runs during idle time — never competes with drag responsiveness.
 */
function _prefetchNextLevel(level, targetRatio) {
  const next = level + 1;
  if (next >= TOTAL_LEVELS) return;
  const entry = LEVELS[next];
  if (!entry || typeof entry.image !== 'string') return;
  const raw = entry.image;
  const m   = raw.match(/url\(['"]?(.*?)['"]?\)/);
  const url = m ? m[1] : raw;
  const key = url + '|' + targetRatio.toFixed(4);
  if (ImageCache.has(key)) return; // already warm
  const run = () => preloadImage(url, 12000, targetRatio).catch(() => {});
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 1200);
  }
}

// ─── GAME START ──────────────────────────────────────────
async function startGame(cfg) {
  // ── Pre-flight: validate and apply safe fallbacks ─────────
  let validated;
  try {
    validated = _validateGameConfig(cfg || {});
  } catch (err) {
    console.error('[PUZZLE] _validateGameConfig threw:', err);
    validated = {
      shape: 'square', level: 0, image: FALLBACK_IMAGE,
      baseSize: 3, isCustom: false, levelShape: 'square',
    };
  }

  let { shape, level, image, baseSize, isCustom, levelShape } = validated;

  // ── Build grid dimensions — shape-specific progression tables ─────
  // Philosophy: most levels are comfortable (small grids); milestone
  // levels spike +1 size for a memorable challenge. isMilestone comes
  // from config.js LEVELS[level].difficulty.
  const isMilestone = !isCustom && (LEVELS[level]?.difficulty === 'milestone');

  let cols = baseSize;   // default: square uses baseSize directly
  let rows = baseSize;

  if (shape === 'rectangle') {
    if (isCustom) {
      cols = baseSize;
      rows = baseSize + 1;   // custom: e.g. size 4 → 4×5
    } else {
      // Portrait-style rectangle: mostly 4×5 / 5×6 comfort zone.
      // Milestone levels spike one step harder.
      if      (level === 0)   { cols = 3; rows = 4; }  // Level 1: easy intro
      else if (level <= 4)    { cols = 3; rows = 4; }  // Levels 2–5
      else if (level <= 14)   { cols = 4; rows = 5; }  // Levels 6–15  ← sweet spot
      else if (level <= 29)   { cols = 4; rows = 5; }  // Levels 16–30
      else if (level <= 59)   { cols = 5; rows = 6; }  // Levels 31–60
      else if (level <= 99)   { cols = 5; rows = 6; }  // Levels 61–100
      else if (level <= 149)  { cols = 6; rows = 7; }  // Levels 101–150
      else if (level <= 199)  { cols = 6; rows = 7; }  // Levels 151–200
      else if (level <= 249)  { cols = 7; rows = 8; }  // Levels 201–250
      else if (level <= 299)  { cols = 7; rows = 8; }  // Levels 251–300
      else                    { cols = 8; rows = 9; }  // Levels 301–350
      // Milestone spike: one extra row (capped at 9)
      if (isMilestone) rows = Math.min(rows + 1, 9);
    }

  } else if (shape === 'triangle') {
    // Triangle grid size: n×n produces n²×2 triangles.
    // Cap at TRIANGLE_MAX (6) for mobile readability.
    // Most levels stay at size 3–4 (18–32 triangles); milestones push to 5–6.
    if (!isCustom) {
      if      (level <= 9)   cols = rows = 3;   //  18 triangles — easy
      else if (level <= 24)  cols = rows = isMilestone ? 4 : 3;  // transition
      else if (level <= 49)  cols = rows = 4;   //  32 triangles — comfortable
      else if (level <= 79)  cols = rows = isMilestone ? 5 : 4;  // transition
      else if (level <= 119) cols = rows = 5;   //  50 triangles — medium
      else if (level <= 179) cols = rows = isMilestone ? 6 : 5;  // transition
      else                   cols = rows = Math.min(6, TRIANGLE_MAX); // 72 — max
      // Hard cap
      cols = rows = Math.min(cols, TRIANGLE_MAX);
    }

  } else if (shape === 'jigsaw') {
    // Jigsaw follows the same base-size as square (from LEVELS[level].size)
    // Milestone spike: bump by 1 (capped at 9)
    if (!isCustom && isMilestone) cols = rows = Math.min(baseSize + 1, 9);

  } else {
    // Square: use baseSize from LEVELS; milestone gets +1 (already baked into
    // config.js LEVELS sizes via the milestone spike — no extra work needed here)
    // cols = rows = baseSize already set above
  }

  // Calculate integer container size BEFORE preloading so we can crop the image
  // to the EXACT aspect ratio of the DOM grid, preventing any stretching.
  const { pieceW, pieceH, containerW, containerH } = computeSize(cols, rows, shape);
  const targetRatio = containerW / containerH;

  // ── Show loading overlay immediately — hides blank stage ──
  _showGameLoading();

  // ── Preload image (hybrid: local=raw URL, external=canvas crop) ──
  let imageMeta = null; // set for local assets; null for canvas-encoded
  try {
    const rawStr       = image || FALLBACK_IMAGE;
    const urlMatch     = rawStr.match(/url\(['"]?(.*?)['"]?\)/);
    const extractedUrl = urlMatch ? urlMatch[1] : rawStr;
    const res = await preloadImage(extractedUrl, 8000, targetRatio);
    if (res.success && res.url) {
      image = `url('${res.url}')`;
      if (res.natural) {
        // Local asset — compute CSS background parameters for center-crop.
        // These replace the canvas data URL approach: same visual result,
        // zero re-encoding cost, instant load from disk.
        const { w: nW, h: nH } = res.natural;
        const imgRatio = nW / nH;
        let sW = nW, sH = nH, sX = 0, sY = 0;
        if (imgRatio > targetRatio) {
          sW = nH * targetRatio; sX = (nW - sW) / 2;
        } else {
          sH = nW / targetRatio; sY = (nH - sH) / 2;
        }
        const scale = containerW / sW; // same as containerH / sH
        imageMeta = {
          bgW:    nW * scale,
          bgH:    nH * scale,
          bgOffX: -sX * scale,
          bgOffY: -sY * scale,
        };
      }
    } else {
      console.warn('[PUZZLE] Image preload failed — using FALLBACK_IMAGE.');
      image = FALLBACK_IMAGE;
    }
  } catch (preloadErr) {
    console.error('[PUZZLE] Exception during image preloading:', preloadErr);
    image = FALLBACK_IMAGE;
  }

  // ── Jigsaw edge map ───────────────────────────────────────
  let hEdges = [], vEdges = [];
  if (shape === 'jigsaw') {
    for (let r = 0; r < rows - 1; r++)
      hEdges.push(Array.from({ length: cols },   () => Math.random() > .5 ? 1 : -1));
    for (let r = 0; r < rows; r++)
      vEdges.push(Array.from({ length: cols - 1 }, () => Math.random() > .5 ? 1 : -1));
  }

  // ── Assign global game state ──────────────────────────────
  G = {
    shape, cols, rows, image, imageMeta, pieceW, pieceH, containerW, containerH,
    hEdges, vEdges, isCustom, level, levelShape,
    pieces: [], slots: buildSlots(cols, rows, pieceW, pieceH), isWon: false,
  };

  // ── Generate pieces ──────────────────────────────────────
  const total = cols * rows;
  getSubTypes(shape).forEach(sub => {
    const order = derangeShuffle(total);
    for (let i = 0; i < total; i++) {
      G.pieces.push({
        id: G.pieces.length, homeSlot: i, currentSlot: order[i],
        subType: sub, groupId: null, wrap: null, inner: null,
      });
    }
  });

  if (DEBUG) {
    const byType = {};
    G.pieces.forEach(p => {
      (byType[p.subType] ??= { homes: new Set(), currents: new Set() });
      const t = byType[p.subType];
      if (t.homes.has(p.homeSlot))       console.warn(`[PUZZLE] Dup homeSlot ${p.homeSlot} in ${p.subType}`);
      if (t.currents.has(p.currentSlot)) console.warn(`[PUZZLE] Dup currentSlot ${p.currentSlot} in ${p.subType}`);
      t.homes.add(p.homeSlot);
      t.currents.add(p.currentSlot);
    });
    console.log(`[PUZZLE] ${G.pieces.length} pieces (${total} cells), ${cols}x${rows}, shape=${shape}, imageMeta=${!!imageMeta}`);
  }

  // ── Update HUD label ──────────────────────────────────────
  const label = document.getElementById('game-label');
  if (label) {
    label.textContent = isCustom
      ? `CUSTOM ${cols}×${rows}`
      : `LEVEL ${level + 1} · ${cols}×${rows}`;
  }

  if (DEBUG) {
    const expectedPieces = (shape === 'triangle' ? 2 : 1) * cols * rows;
    if (G.pieces.length !== expectedPieces) {
      console.error(`[PUZZLE] Piece count mismatch: got ${G.pieces.length}, expected ${expectedPieces}`);
    }
  }

  // ── Render + initialise engine state ─────────────────────
  moveCount = 0;
  try {
    _hideGameLoading(); // clear loading overlay before rendering pieces
    buildGrid();
    // Smooth fade-in — masks any brief repaint between levels
    (function _fadePuzzleIn() {
      const g = document.getElementById('puzzle-grid');
      if (!g) return;
      g.style.opacity    = '0';
      g.style.transition = '';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        g.style.transition = 'opacity 0.35s ease';
        g.style.opacity    = '1';
        setTimeout(() => { if (g) g.style.transition = ''; }, 400);
      }));
    })();
    Timer.reset();
    _updateMovesHUD();
    _updateCoinHUD();
    buildMatrix();
    recalculateGroups();
    prevGroupCount = new Set(G.pieces.map(p => p.groupId)).size;
    // Prefetch next campaign level during idle time — Next Level feels instant
    if (!isCustom) _prefetchNextLevel(level, targetRatio);
  } catch (err) {
    console.error('[PUZZLE] Render failed, attempting 3×3 recovery:', err);
    _hideGameLoading();
    try {
      startGame({ shape: 'square', level: 0 });
    } catch (fatal) {
      console.error('[PUZZLE] Fatal: even recovery failed.', fatal);
    }
  }
}


// ─── GROUP SYSTEM (BFS) ──────────────────────────────────
function offsetOf(p) {
  return {
    dc: (p.currentSlot % G.cols) - (p.homeSlot % G.cols),
    dr: Math.floor(p.currentSlot / G.cols) - Math.floor(p.homeSlot / G.cols),
  };
}

function recalculateGroups() {
  const grid = document.getElementById('puzzle-grid');
  // Dissolve existing group wrappers back to flat list
  grid.querySelectorAll('.group-wrap').forEach(w => {
    w.querySelectorAll('.piece-wrap').forEach(pw => grid.appendChild(pw));
    w.remove();
  });
  G.pieces.forEach(p => { p.groupId = null; });
  let nextId = 0;

  if (G.shape === 'triangle') {
    // ── TRIANGLE: tile-pair BFS ─────────────────────────────
    // GROUP RULE:
    //   A valid group unit is a "complete tile":
    //   - one UP piece (tri-a) + one DOWN piece (tri-b) at the SAME currentSlot
    //   - both pieces share the same (dc, dr) offset from their home
    //   This enforces: adjacent + opposite orientations + valid rectangle.
    //
    // Adjacent complete tiles with matching offsets merge into a group.
    // Pieces not in a complete tile are isolated (get their own groupId).

    // 1. Index by subType -> currentSlot
    const bySlot = { 'tri-upper': {}, 'tri-lower': {} };
    G.pieces.forEach(p => { bySlot[p.subType][p.currentSlot] = p; });

    // 2. Find complete tiles: slots where UP+DOWN are both present,
    //    and same (dc,dr) offset.
    const tiles = {};  // currentSlot -> { a, b, dc, dr }
    for (const [slotStr, a] of Object.entries(bySlot['tri-upper'])) {
      const slot = +slotStr;
      const b = bySlot['tri-lower'][slot];
      if (!b) continue;
      const { dc: dca, dr: dra } = offsetOf(a);
      const { dc: dcb, dr: drb } = offsetOf(b);
      if (dca !== dcb || dra !== drb) continue;  // UP/DOWN not in same relative position
      tiles[slot] = { a, b, dc: dca, dr: dra };
    }

    // 3. BFS over complete tiles: adjacent tiles with same (dc,dr) merge.
    const visitedSlots = new Set();
    for (const [slotStr, tile] of Object.entries(tiles)) {
      const startSlot = +slotStr;
      if (visitedSlots.has(startSlot)) continue;
      const { dc: dc0, dr: dr0 } = tile;
      const queue = [startSlot], comp = [];

      while (queue.length) {
        const s = queue.shift();
        if (visitedSlots.has(s)) continue;
        const t = tiles[s];
        if (!t || t.dc !== dc0 || t.dr !== dr0) continue;
        visitedSlots.add(s);
        comp.push(t.a, t.b);
        const sc = s % G.cols, sr = Math.floor(s / G.cols);
        for (const [nc, nr] of [[sc+1,sr],[sc-1,sr],[sc,sr+1],[sc,sr-1]]) {
          if (nc < 0 || nc >= G.cols || nr < 0 || nr >= G.rows) continue;
          const ns = nr * G.cols + nc;
          if (!visitedSlots.has(ns) && tiles[ns]) queue.push(ns);
        }
      }
      const gid = nextId++;
      comp.forEach(p => { p.groupId = gid; });
    }
    // 4. Incomplete tiles (only one half, or mismatched offset) -> isolated
    G.pieces.forEach(p => { if (p.groupId === null) p.groupId = nextId++; });

  } else {
    // ── NON-TRIANGLE: offset-equality BFS (unchanged) ───────
    const slotMap = {};
    G.pieces.forEach(p => { (slotMap[p.subType] ??= {})[p.currentSlot] = p; });
    const visited = new Set();
    G.pieces.forEach(startP => {
      const key = `${startP.subType}_${startP.id}`;
      if (visited.has(key)) return;
      const { dc: dc0, dr: dr0 } = offsetOf(startP);
      const queue = [startP], comp = [];
      while (queue.length) {
        const p = queue.shift();
        const pk = `${p.subType}_${p.id}`;
        if (visited.has(pk)) continue;
        visited.add(pk); comp.push(p);
        const pc = p.currentSlot % G.cols, pr = Math.floor(p.currentSlot / G.cols);
        for (const [nc, nr] of [[pc+1,pr],[pc-1,pr],[pc,pr+1],[pc,pr-1]]) {
          if (nc < 0 || nc >= G.cols || nr < 0 || nr >= G.rows) continue;
          const n = slotMap[p.subType]?.[nr * G.cols + nc];
          if (!n || visited.has(`${n.subType}_${n.id}`)) continue;
          const { dc, dr } = offsetOf(n);
          if (dc === dc0 && dr === dr0) queue.push(n);
        }
      }
      const gid = nextId++; comp.forEach(p => { p.groupId = gid; });
    });
  }

  // DOM: wrap each group into a .group-wrap container
  const byGroup = {};
  G.pieces.forEach(p => { (byGroup[p.groupId] ??= []).push(p); });
  Object.values(byGroup).forEach(members => {
    const wrap = document.createElement('div');
    wrap.className = 'group-wrap';
    if (G.shape === 'triangle' && members.length >= 2) {
      wrap.classList.add('tri-solved');
    }
    grid.appendChild(wrap);
    members.forEach(p => wrap.appendChild(p.wrap));
  });

  // ── Apply dynamic borders for Square / Rectangle groups ─────────
  if (G.shape === 'square' || G.shape === 'rectangle') {
    G.pieces.forEach(p => {
      const hc = p.homeSlot % G.cols;
      const hr = Math.floor(p.homeSlot / G.cols);
      const members = byGroup[p.groupId];
      
      const hasTop    = hr > 0          && members.some(m => m.homeSlot === p.homeSlot - G.cols);
      const hasBottom = hr < G.rows - 1 && members.some(m => m.homeSlot === p.homeSlot + G.cols);
      const hasLeft   = hc > 0          && members.some(m => m.homeSlot === p.homeSlot - 1);
      const hasRight  = hc < G.cols - 1 && members.some(m => m.homeSlot === p.homeSlot + 1);
      
      const r = '9px'; // Soft premium radius
      const bw = '1px'; // Outer border
      
      p.inner.style.borderTopWidth    = hasTop    ? '0' : bw;
      p.inner.style.borderRightWidth  = hasRight  ? '0' : bw;
      p.inner.style.borderBottomWidth = hasBottom ? '0' : bw;
      p.inner.style.borderLeftWidth   = hasLeft   ? '0' : bw;
      
      p.inner.style.borderTopLeftRadius     = (hasTop || hasLeft)     ? '0' : r;
      p.inner.style.borderTopRightRadius    = (hasTop || hasRight)    ? '0' : r;
      p.inner.style.borderBottomLeftRadius  = (hasBottom || hasLeft)  ? '0' : r;
      p.inner.style.borderBottomRightRadius = (hasBottom || hasRight) ? '0' : r;
      
      // Overlap compensation: gracefully extend connected right/bottom edges by 1.5px 
      // to completely eliminate fractional anti-aliasing seams and subpixel gaps.
      // Top-left origin remains anchored so background-position stays perfectly aligned.
      const ov = 1.5; 
      p.inner.style.width  = (G.pieceW + (hasRight  ? ov : 0)) + 'px';
      p.inner.style.height = (G.pieceH + (hasBottom ? ov : 0)) + 'px';
    });
  }
}


// ─── DRAG ────────────────────────────────────────────────
function _onPointerDown(e, piece) {
  if (dragState || (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse')) return;
  e.preventDefault();
  Timer.startIfFirst(); Audio.play('drag'); haptic(10);

  const members   = G.pieces.filter(p => p.groupId === piece.groupId);
  const groupWrap = piece.wrap.parentElement;

  members.forEach(p => {
    const s = G.slots[p.currentSlot];
    p._dsx = s.x; p._dsy = s.y;
    // Kill any in-flight transition so drag starts instantly
    p.wrap.style.transition = 'none';
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  members.forEach(p => {
    minX = Math.min(minX, p._dsx); minY = Math.min(minY, p._dsy);
    maxX = Math.max(maxX, p._dsx + G.pieceW); maxY = Math.max(maxY, p._dsy + G.pieceH);
  });
  groupWrap.classList.add('dragging');
  members.forEach(p => p.wrap.classList.add('dragging'));

  dragState = {
    piece, members, groupWrap,
    startX: e.clientX, startY: e.clientY, dx: 0, dy: 0,
    lastDX: null, lastDY: null,   // dirty-check — skip RAF write if unchanged
    minDX: -minX, maxDX: G.containerW - maxX,
    minDY: -minY, maxDY: G.containerH - maxY,
  };
  e.currentTarget.setPointerCapture(e.pointerId);
  document.addEventListener('pointermove',   _onPointerMove,  { passive: false });
  document.addEventListener('pointerup',     _onPointerUp,    { passive: false });
  document.addEventListener('pointercancel', _onPointerUp,    { passive: false });
  dragRafId = requestAnimationFrame(_dragLoop);
}

function _onPointerMove(e) {
  if (!dragState) return; e.preventDefault();
  dragState.dx = Math.max(dragState.minDX, Math.min(e.clientX - dragState.startX, dragState.maxDX));
  dragState.dy = Math.max(dragState.minDY, Math.min(e.clientY - dragState.startY, dragState.maxDY));
}

function _dragLoop() {
  if (!dragState) return;
  const { dx, dy, lastDX, lastDY, groupWrap } = dragState;
  // Skip DOM write if pointer hasn't moved since last frame
  if (dx !== lastDX || dy !== lastDY) {
    groupWrap.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    dragState.lastDX = dx;
    dragState.lastDY = dy;
  }
  dragRafId = requestAnimationFrame(_dragLoop);
}

function _onPointerUp() {
  if (!dragState) return;
  cancelAnimationFrame(dragRafId); dragRafId = null;
  const { piece, members, groupWrap, dx, dy } = dragState;

  // Freeze the group-wrap transform visually before clearing it
  groupWrap.style.transition = 'none';
  groupWrap.classList.remove('dragging');
  members.forEach(p => p.wrap.classList.remove('dragging'));

  const slot    = G.slots[piece.currentSlot];
  const tCol    = Math.max(0, Math.min(G.cols - 1, Math.round((slot.x + dx) / G.pieceW)));
  const tRow    = Math.max(0, Math.min(G.rows - 1, Math.round((slot.y + dy) / G.pieceH)));
  const colShift = tCol - (piece.currentSlot % G.cols);
  const rowShift = tRow - Math.floor(piece.currentSlot / G.cols);

  let movedIds = new Set(members.map(p => p.id)), swapped = false;
  if (colShift || rowShift) {
    const r = _executeSwap(members, colShift, rowShift);
    swapped = r.success; r.movedIds.forEach(id => movedIds.add(id));
  }

  if (swapped) {
    Audio.play('swap'); haptic(20);
    moveCount++;
    _updateMovesHUD();
  }

  // FLIP with translate3d: compute visual offset from target slot, snap there
  // instantly as a transform, then animate transform → identity.
  const gx = dx, gy = dy;   // group was at (gx, gy) from its base
  groupWrap.style.transform = '';

  requestAnimationFrame(() => {
    movedIds.forEach(id => {
      const p = G.pieces.find(x => x.id === id);
      if (!p) return;
      const s = G.slots[p.currentSlot];
      // Where the piece visually appears right now:
      //   - dragged members: their translate3d base (s was _dsx/_dsy) + group translate
      //   - displaced pieces: they were at their old slot, no group offset
      const wasMember = members.includes(p);
      const visualX = (wasMember ? p._dsx : (parseFloat(p.wrap.style.transform.match(/translate3d\(([^,]+)/)?.[1]) || s.x)) + (wasMember ? gx : 0);
      const visualY = (wasMember ? p._dsy : (parseFloat(p.wrap.style.transform.match(/translate3d\([^,]+,([^,]+)/)?.[1]) || s.y)) + (wasMember ? gy : 0);
      const offX = visualX - s.x;
      const offY = visualY - s.y;

      // Place piece at target slot, offset by the visual delta (no animation yet)
      p.wrap.style.transition = 'none';
      p.wrap.style.transform  = `translate3d(${offX}px,${offY}px,0)`;
    });

    // Reflow: let the browser commit the snap-to-offset before starting transition
    void document.getElementById('puzzle-grid')?.offsetWidth;

    requestAnimationFrame(() => {
      movedIds.forEach(id => {
        const p = G.pieces.find(x => x.id === id);
        if (!p) return;
        const s = G.slots[p.currentSlot];
        // Animate from the current visual offset (offX,offY) to the home position (sx,sy).
        // positionPiece uses translate3d(sx,sy,0) as the resting state,
        // so we animate TO translate3d(sx,sy,0) from the snap offset.
        p.wrap.style.transition = 'transform 0.22s cubic-bezier(0.2,0.8,0.2,1)';
        p.wrap.style.transform  = `translate3d(${s.x}px,${s.y}px,0)`;
        p._dsx = s.x; p._dsy = s.y;
      });
      setTimeout(() => movedIds.forEach(id => {
        const p = G.pieces.find(x => x.id === id);
        if (p) {
          p.wrap.style.transition = 'none';
          // Ensure clean resting state
          const s = G.slots[p.currentSlot];
          p._dsx = s.x; p._dsy = s.y;
        }
      }), 240);
    });
  });

  document.removeEventListener('pointermove',   _onPointerMove);
  document.removeEventListener('pointerup',     _onPointerUp);
  document.removeEventListener('pointercancel', _onPointerUp);
  dragState = null;

  setTimeout(() => {
    recalculateGroups();
    const newCount = new Set(G.pieces.map(p => p.groupId)).size;
    if (newCount < prevGroupCount) {
      Audio.play('group');
      G.pieces.forEach(p => {
        if (movedIds.has(p.id) && p.wrap) {
          p.wrap.classList.add('group-glow');
          setTimeout(() => p.wrap.classList.remove('group-glow'), 600);
        }
      });
    }
    prevGroupCount = newCount;
    _checkWin();
  }, 250);
}

// ─── SWAP ENGINE ─────────────────────────────────────────
function _executeSwap(members, colShift, rowShift) {
  const { cols, rows } = G;
  const memberIds = new Set(members.map(p => p.id));
  const movedIds  = new Set();

  const dragMoves = [];
  for (const p of members) {
    const nc = (p.currentSlot % cols) + colShift;
    const nr = Math.floor(p.currentSlot / cols) + rowShift;
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return { success: false, movedIds };
    dragMoves.push({ piece: p, fromSlot: p.currentSlot, toSlot: nr * cols + nc });
  }

  const displacedMoves = [];
  for (const sub of getSubTypes(G.shape)) {
    const subMoves  = dragMoves.filter(m => m.piece.subType === sub);
    if (!subMoves.length) continue;
    const subFrom   = new Set(subMoves.map(m => m.fromSlot));
    const subTo     = new Set(subMoves.map(m => m.toSlot));
    const vacated   = [...subFrom].filter(s => !subTo.has(s)).sort((a, b) => a - b);
    const occupied  = [...subTo].filter(s => !subFrom.has(s)).sort((a, b) => a - b);
    if (occupied.length > vacated.length) return { success: false, movedIds };
    for (let i = 0; i < occupied.length; i++) {
      const oid = matrixGet(sub, occupied[i]);
      if (oid !== null && !memberIds.has(oid)) {
        const occ = G.pieces.find(p => p.id === oid);
        if (occ) displacedMoves.push({ piece: occ, fromSlot: occupied[i], toSlot: vacated[i] });
      }
    }
  }

  const allMoves  = [...dragMoves, ...displacedMoves];
  const destKeys  = allMoves.map(m => `${m.piece.subType}_${m.toSlot}`);
  if (new Set(destKeys).size !== destKeys.length) return { success: false, movedIds };

  // Triangle: no slot-type gate needed.
  // The gridMatrix is keyed per subType, so _executeSwap naturally isolates
  // tri-upper pieces (only displace other tri-upper) and tri-lower likewise.
  // A tri-upper can land on ANY cell's tri-upper slot — all cells have the same
  // diagonal direction so orientation is always preserved.

  // Atomic commit — two-phase to avoid mid-commit conflicts
  allMoves.forEach(m  => { m.piece._ns = m.toSlot; });
  allMoves.forEach(m  => matrixSet(m.piece.subType, m.fromSlot, null));
  allMoves.forEach(m  => {
    m.piece.currentSlot = m.piece._ns; delete m.piece._ns;
    matrixSet(m.piece.subType, m.piece.currentSlot, m.piece.id);
    movedIds.add(m.piece.id);
  });
  return { success: true, movedIds };
}

// ─── WIN ANIMATION HELPERS ───────────────────────────────
let _autoAdvTimer = null;

/** Cancel any pending auto-advance. Safe to call when none is active. */
function _cancelAutoAdvance() {
  if (_autoAdvTimer) { clearTimeout(_autoAdvTimer); _autoAdvTimer = null; }
  const bar = document.getElementById('auto-advance-bar');
  if (bar) bar.style.display = 'none';
}

/**
 * After `delayMs` ms, auto-click the next-level button.
 * Fills a progress bar so the player has a visible countdown.
 * No-ops for custom puzzles and the final campaign level.
 */
function _startAutoAdvance(delayMs) {
  _cancelAutoAdvance();
  if (G.isCustom || G.level >= TOTAL_LEVELS - 1) return;
  const bar  = document.getElementById('auto-advance-bar');
  const fill = document.getElementById('aab-fill');
  if (!bar || !fill) return;
  bar.style.display = 'flex';
  fill.style.transition = 'none';
  fill.style.width      = '0%';
  fill.getBoundingClientRect();   // force reflow before CSS transition starts
  fill.style.transition = `width ${delayMs}ms linear`;
  fill.style.width      = '100%';
  _autoAdvTimer = setTimeout(() => {
    _autoAdvTimer = null;
    const nb = document.getElementById('btn-next-level');
    if (nb && nb.style.display !== 'none') nb.click();
  }, delayMs);
}

/**
 * Animate a coin counter from 0 → target over `ms` milliseconds.
 * Cubic ease-out makes the number slow to a satisfying stop.
 */
function _animateCoinCount(element, target, ms) {
  if (!element || target <= 0) return;
  const t0 = performance.now();
  (function tick(now) {
    const p     = Math.min((now - t0) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    element.textContent = '+' + Math.round(target * eased) + ' coins';
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

// ─── WIN DETECTION ───────────────────────────────────────
function _checkWin() {
  if (G.isWon || !G.pieces.every(p => p.currentSlot === p.homeSlot)) return;
  G.isWon = true; Timer.pause();
  document.getElementById('puzzle-grid').classList.add('won');

  const elapsed = Timer.elapsed;
  const shape   = G.levelShape || G.shape;
  const key     = `${shape}_${G.level}`;
  const prev    = Save.data.bestTimes[key];
  const isNew   = !prev || elapsed < prev;
  if (isNew && !G.isCustom) Save.data.bestTimes[key] = elapsed;
  if (!G.isCustom && G.level + 1 > (Save.data.progress[shape] || 0))
    Save.data.progress[shape] = G.level + 1;

  // ── Leaderboard Score ─────────────────────────────────────────
  const pieceCount = G.cols * G.rows;
  let scoreMult = 1;
  if (G.shape === 'jigsaw')   scoreMult = 1.5;
  if (G.shape === 'triangle') scoreMult = 1.2;
  const score = Math.max(100, Math.floor(
    (pieceCount * 1000 - (elapsed / 10) - (moveCount * 50)) * scoreMult
  ));
  const levelDisplay = G.isCustom ? `${G.cols}×${G.rows}` : `Level ${G.level + 1}`;
  if (typeof DB !== 'undefined' && DB.leaderboard) {
    DB.leaderboard.saveScore(Save.data.username || 'Player', score, G.shape, levelDisplay, !!G.isCustom);
  }

  // ── Stars & Coin System (campaign only) ───────────────────
  // Now passes elapsed time so 3-star threshold can factor in speed.
  const stars = calculateStars(moveCount, G.cols, G.rows, G.shape, elapsed);
  let coinsEarned = 0;
  if (!G.isCustom) {
    if (!Save.data.bestStars) Save.data.bestStars = {};
    const prevStars = Save.data.bestStars[key] || 0;
    if (stars > prevStars) {
      // Award the DIFFERENCE so replaying for higher stars is incremental
      const coinMap = { 1: 10, 2: 25, 3: 50 };
      coinsEarned = (coinMap[stars] || 10) - (coinMap[prevStars] || 0);
      Save.data.totalCoins     = (Save.data.totalCoins || 0) + coinsEarned;
      Save.data.bestStars[key] = stars;
    }
  }
  Save.flush();
  _updateCoinHUD();

  // ── Populate victory modal elements ───────────────────────
  const timeEl = document.getElementById('victory-time');
  if (timeEl) timeEl.textContent = `Time: ${fmtTime(elapsed)}`;

  const bestEl = document.getElementById('victory-best');
  if (bestEl) {
    if (isNew && !G.isCustom) bestEl.textContent = 'New Best Time! 🏅';
    else if (!G.isCustom && prev) bestEl.textContent = `Best: ${fmtTime(prev)}`;
    else bestEl.textContent = '';
  }

  // Star row
  const starsEl = document.getElementById('victory-stars');
  if (starsEl) {
    starsEl.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const s = document.createElement('span');
      s.className   = i <= stars ? 'vstar vstar-on' : 'vstar vstar-off';
      s.textContent = '★';
      starsEl.appendChild(s);
    }
  }

  // Coin counter
  const coinsRow = document.getElementById('victory-coins-row');
  const coinsEl  = document.getElementById('victory-coins');
  if (coinsRow && coinsEl) {
    if (coinsEarned > 0) { coinsEl.textContent = '+0 coins'; coinsRow.classList.remove('hidden'); }
    else coinsRow.classList.add('hidden');
  }

  const titleEl = document.querySelector('.victory-title');
  if (titleEl) titleEl.textContent = G.isCustom ? 'SOLVED!' : 'LEVEL COMPLETE';

  // ── Star-gated Next Level ─────────────────────────────────
  // Campaign only: player needs ≥2 stars to advance.
  // Grandfathering: if bestStars has no record for the previous level
  // (existing player before this system), unlock is allowed.
  const nextBtn = document.getElementById('btn-next-level');
  const isLastLevel = G.level >= TOTAL_LEVELS - 1;
  const canAdvance  = G.isCustom || isLastLevel || stars >= 2;

  if (nextBtn) {
    if (G.isCustom || isLastLevel) {
      nextBtn.style.display = 'none';
    } else if (canAdvance) {
      nextBtn.style.display   = '';
      nextBtn.textContent     = '⏭ Next Level';
      nextBtn.disabled        = false;
      nextBtn.style.opacity   = '1';
      nextBtn.style.cursor    = 'pointer';
    } else {
      // 1-star: show locked state — friendly, never mean
      nextBtn.style.display   = '';
      nextBtn.textContent     = '🔒 Need ⭐⭐ to unlock';
      nextBtn.disabled        = true;
      nextBtn.style.opacity   = '0.55';
      nextBtn.style.cursor    = 'default';
    }
  }

  // Show a hint below stars when 1-star
  const unlockHint = document.getElementById('victory-unlock-hint');
  if (unlockHint) {
    if (!G.isCustom && !isLastLevel && stars < 2) {
      unlockHint.textContent = 'Replay to earn ⭐⭐ and continue!';
      unlockHint.style.display = '';
    } else {
      unlockHint.style.display = 'none';
    }
  }

  setTimeout(() => {
    if (typeof spawnConfetti === 'function') spawnConfetti();
    if (typeof openModal    === 'function') openModal('modal-victory');
    if (typeof haptic       === 'function') haptic(200);
    Audio.play('win');
    if (coinsEarned > 0 && coinsEl) _animateCoinCount(coinsEl, coinsEarned, 700);
    // Auto-advance only when player earned enough stars to proceed
    if (canAdvance && !isLastLevel && !G.isCustom) _startAutoAdvance(3500);
  }, 800);
}
