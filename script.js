'use strict';
/* ═══════════════════════════════════════════
   MOSAIC PUZZLE — Game Engine v3.0
   ═══════════════════════════════════════════ */

const TOTAL_LEVELS = 350, TRIANGLE_MAX = 6, MASTER_UNLOCK = 50, MASTER_LEVELS = 20;
const SHAPES = ['square','rectangle','triangle','jigsaw'];
const GAP = 0;   // zero gap — seamless puzzle
const DEBUG = false;
const FALLBACK_IMAGE = `url('https://picsum.photos/id/1/400/400')`;

// ─── LEVELS ──────────────────────────────────────────────
const LEVELS = Array.from({length: TOTAL_LEVELS}, (_, i) => {
  const n = i + 1;
  let g = n <= 45 ? 3 : n <= 55 ? (n%2?3:4) : n <= 115 ? 4 : n <= 125 ? (n%2?4:5)
    : n <= 165 ? 5 : n <= 175 ? (n%2?5:6) : n <= 215 ? 6 : n <= 225 ? (n%2?6:7)
    : n <= 255 ? 7 : n <= 265 ? (n%2?7:8) : n <= 295 ? 8 : n <= 305 ? (n%2?8:9) : 9;
  return { size: g };
});

// ─── SAVE ────────────────────────────────────────────────
const Save = {
  KEY: 'mosaic_v2', data: null,
  defaults: () => ({
    username: null, progress: {square:0,rectangle:0,triangle:0,jigsaw:0},
    bestTimes: {}, settings: {sound:true,haptic:true,bgm:false},
    following: [], likedPuzzles: [], daily: {}, masterDone: [],
  }),
  load()  { try { const r = localStorage.getItem(this.KEY); this.data = r ? {...this.defaults(),...JSON.parse(r)} : this.defaults(); } catch(e) { this.data = this.defaults(); } },
  flush() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch(e) {} },
  totalSolved() { return SHAPES.reduce((s,sh) => s + (this.data.progress[sh]||0), 0); }
};

// ─── AUDIO ───────────────────────────────────────────────
const Audio = {
  ctx: null, bgmGain: null, bgmNodes: [], bgmPlaying: false, _bgmTimer: null, _bgmPad: null,
  init() {
    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext||window.webkitAudioContext)();
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
      drag:[[400,.06,.08]], swap:[[660,.12,.12],[880,.08,.1]],
      group:[[523,.14,.25],[659,.1,.2],[784,.08,.18]],
      win:[[523,.2,.6],[659,.18,.55],[784,.15,.5],[1047,.12,.45]],
    };
    (sfx[type]||[]).forEach(([f,v,d]) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.connect(g); g.connect(this.ctx.destination);
      o.type = type === 'win' ? 'sine' : 'triangle';
      o.frequency.value = f; g.gain.setValueAtTime(v,now);
      g.gain.exponentialRampToValueAtTime(0.001, now+d);
      o.start(now); o.stop(now+d);
    });
  },
  startBGM() {
    if (!this.ctx || this.bgmPlaying) return;
    this.bgmPlaying = true;
    const notes = [261.63,329.63,392,523.25,392,329.63]; let idx = 0;
    const tick = () => {
      if (!this.bgmPlaying) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type='sine'; o.frequency.value = notes[idx++%notes.length];
      g.gain.setValueAtTime(0,this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(.06,this.ctx.currentTime+.3);
      g.gain.linearRampToValueAtTime(0,this.ctx.currentTime+2.5);
      o.connect(g); g.connect(this.bgmGain);
      o.start(this.ctx.currentTime); o.stop(this.ctx.currentTime+2.8);
      this._bgmTimer = setTimeout(tick, 2200+Math.random()*600);
    };
    tick();
    const p = this.ctx.createOscillator(), pg = this.ctx.createGain();
    p.type='sine'; p.frequency.value=130.81; pg.gain.value=.03;
    p.connect(pg); pg.connect(this.bgmGain); p.start();
    this._bgmPad = p;
  },
  stopBGM() {
    this.bgmPlaying = false;
    clearTimeout(this._bgmTimer);
    this.bgmNodes.forEach(n=>{try{n.stop();}catch(e){}});
    this.bgmNodes = [];
    if (this._bgmPad) { try{this._bgmPad.stop();}catch(e){} this._bgmPad=null; }
  },
  toggleBGM() { this.bgmPlaying ? this.stopBGM() : this.startBGM(); return this.bgmPlaying; }
};

function haptic(ms=10) { if (Save.data.settings.haptic && navigator.vibrate) navigator.vibrate(ms); }

// ─── NAVIGATION ──────────────────────────────────────────
const Nav = {
  stack: [],
  go(id, data={}) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active'); el.scrollTop = 0;
    this.stack.push({id,data}); this._enter(id,data);
  },
  back() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    const prev = this.stack[this.stack.length-1];
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(prev.id);
    if (el) { el.classList.add('active'); el.scrollTop = 0; }
    this._enter(prev.id, prev.data);
  },
  _enter(id, data) {
    const handlers = {
      'screen-home':           renderHome,
      'screen-shape-select':   renderShapeSelect,
      'screen-levels':         () => renderLevelMap(data),
      'screen-game':           () => startGame(data),
      'screen-daily':          renderDaily,
      'screen-master':         renderMaster,
      'screen-explore':        renderCommunity,
      'screen-profile':        renderProfile,
      'screen-public-profile': () => renderPublicProfile(data.username),
      'screen-messages':       renderMessages,
      'screen-chat':           () => renderChat(data.peerUid),
    };
    (handlers[id] || (() => {}))();
  },
  current() { return this.stack.length ? this.stack[this.stack.length-1].id : null; }
};

// ─── TIMER ───────────────────────────────────────────────
const Timer = {
  startMs:0, elapsed:0, rafId:null, running:false, started:false,
  start() {
    if (this.running) return;
    this.startMs = Date.now() - this.elapsed;
    this.running = true; this.started = true; this._tick();
  },
  pause() { this.running = false; if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; } },
  reset() { this.pause(); this.elapsed = 0; this.started = false; this._render(0); },
  startIfFirst() { if (!this.started) this.start(); },
  _tick() {
    if (!this.running) return;
    this.elapsed = Date.now() - this.startMs;
    this._render(this.elapsed);
    this.rafId = requestAnimationFrame(() => this._tick());
  },
  _render(ms) { const el = document.getElementById('game-timer'); if (el) el.textContent = fmtTime(ms); },
  display() { return fmtTime(this.elapsed); }
};
function fmtTime(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

// ─── COMMUNITY (puzzle feed) ─────────────────────────────
const Community = {
  _get(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e) { return []; } },
  _set(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
  getPublic() { return this._get('mosaic_community'); },
  getUser()   { return this._get('mosaic_user_puzzles'); },
  publish(p) { const pub=this.getPublic(), usr=this.getUser(); pub.unshift(p); usr.unshift(p); this._set('mosaic_community',pub); this._set('mosaic_user_puzzles',usr); },
  toggleLike(id) {
    const liked = Save.data.likedPuzzles, idx = liked.indexOf(id);
    idx===-1 ? liked.push(id) : liked.splice(idx,1); Save.flush();
    const pub = this.getPublic(), p = pub.find(x=>x.id===id);
    if (p) { p.likes = (p.likes||0) + (idx===-1?1:-1); this._set('mosaic_community',pub); }
    return idx === -1;
  },
  isLiked(id) { return Save.data.likedPuzzles.includes(id); },
  seed() {
    if (this.getPublic().length) return;
    this._set('mosaic_community', [
      {id:'demo1',creator:'ArtBot',image:"url('https://picsum.photos/id/15/300/300')",size:3,shape:'square',likes:14,title:'Sunrise'},
      {id:'demo2',creator:'PuzzlePro',image:"url('https://picsum.photos/id/29/300/300')",size:4,shape:'jigsaw',likes:8,title:'Ocean View'},
      {id:'demo3',creator:'ArtBot',image:"url('https://picsum.photos/id/43/300/300')",size:3,shape:'triangle',likes:22,title:'Mountain'},
      {id:'demo4',creator:'Mosaic',image:"url('https://picsum.photos/id/57/300/300')",size:4,shape:'square',likes:5,title:'Forest'},
    ]);
  }
};

// ─── DB: User Social System (Firebase-ready) ─────────────
// Data model mirrors Firestore flat-collection structure.
// Swap localStorage calls for Firebase SDK calls to go live.
const DB = {
  // ── HELPERS ──────────────────────────────────────────────
  _get(k) { try { return JSON.parse(localStorage.getItem(k)) ?? null; } catch { return null; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },

  // ── USERS collection: { uid, username, avatar, createdAt } ──
  users: {
    DEMO: [
      { uid:'u_artbot',    username:'ArtBot',    avatar:'🤖', createdAt: Date.now()-864e5*30 },
      { uid:'u_puzzlepro', username:'PuzzlePro', avatar:'🧩', createdAt: Date.now()-864e5*20 },
      { uid:'u_mosaic',    username:'Mosaic',    avatar:'🔷', createdAt: Date.now()-864e5*15 },
      { uid:'u_pixelqueen',username:'PixelQueen',avatar:'👑', createdAt: Date.now()-864e5*10 },
      { uid:'u_stormzen',  username:'StormZen',  avatar:'⚡', createdAt: Date.now()-864e5*5  },
      { uid:'u_novaglyph', username:'NovaGlyph', avatar:'🌌', createdAt: Date.now()-864e5*2  },
    ],

    _store() { return DB._get('mosaic_users') || {}; },
    _save(users) { DB._set('mosaic_users', users); },

    seed() {
      const users = this._store();
      this.DEMO.forEach(u => { if (!users[u.uid]) users[u.uid] = u; });
      this._save(users);
    },

    create(username) {
      const uid = 'u_' + username.toLowerCase().replace(/[^a-z0-9]/g,'') + '_' + Date.now().toString(36);
      const user = { uid, username, avatar: '🧑', createdAt: Date.now() };
      const users = this._store(); users[uid] = user; this._save(users);
      return user;
    },

    getAll() { return Object.values(this._store()); },
    get(uid) { return this._store()[uid] || null; },

    // Find user by username (case-insensitive)
    findByName(name) {
      return Object.values(this._store()).find(u => u.username.toLowerCase() === name.toLowerCase()) || null;
    },

    // Ensure current player has a DB user record; return uid
    ensureCurrentUser() {
      const name = Save.data.username || 'Player';
      let user = this.findByName(name);
      if (!user) user = this.create(name);
      return user.uid;
    }
  },

  // ── FOLLOWS collection: { followerUid, followingUid, ts } ──
  // Key: `${followerUid}_${followingUid}`
  follows: {
    _store() { return DB._get('mosaic_follows') || {}; },
    _save(f) { DB._set('mosaic_follows', f); },

    key: (a, b) => `${a}_${b}`,

    isFollowing(followerUid, followingUid) {
      return !!this._store()[this.key(followerUid, followingUid)];
    },

    toggle(followerUid, followingUid) {
      const f = this._store(), k = this.key(followerUid, followingUid);
      if (f[k]) { delete f[k]; this._save(f); return false; }
      f[k] = { followerUid, followingUid, ts: Date.now() };
      this._save(f); return true;
    },

    followersOf(uid) {
      return Object.values(this._store()).filter(r => r.followingUid === uid).length;
    },
    followingOf(uid) {
      return Object.values(this._store()).filter(r => r.followerUid === uid).length;
    },
    // UIDs that `uid` follows
    followingUids(uid) {
      return Object.values(this._store()).filter(r => r.followerUid === uid).map(r => r.followingUid);
    },
    // Usernames that uid follows (for community feed compat)
    followingNames(uid) {
      const users = DB.users._store();
      return this.followingUids(uid).map(fuid => users[fuid]?.username).filter(Boolean);
    },
  },

  // ── MESSAGES collection ──────────────────────────────────
  // chatId = [uid1, uid2].sort().join('_') — symmetric
  // Each message: { id, senderUid, receiverUid, text, ts }
  messages: {
    _store() { return DB._get('mosaic_messages') || {}; },
    _save(m) { DB._set('mosaic_messages', m); },

    chatId: (a, b) => [a, b].sort().join('_'),

    send(senderUid, receiverUid, text) {
      const m = this._store();
      const cid = this.chatId(senderUid, receiverUid);
      if (!m[cid]) m[cid] = [];
      const msg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        senderUid, receiverUid, text: text.trim(), ts: Date.now() };
      m[cid].push(msg);
      this._save(m);
      return msg;
    },

    getChat(uid1, uid2) {
      const m = this._store()[this.chatId(uid1, uid2)] || [];
      return [...m].sort((a, b) => a.ts - b.ts); // oldest first for display
    },

    // All conversations for a uid → sorted by latest message
    getConversations(uid) {
      const m = this._store();
      const convos = [];
      Object.entries(m).forEach(([cid, msgs]) => {
        if (!cid.includes(uid)) return;
        if (!msgs.length) return;
        const sorted = [...msgs].sort((a, b) => b.ts - a.ts);
        const latest = sorted[0];
        const peerUid = latest.senderUid === uid ? latest.receiverUid : latest.senderUid;
        convos.push({ cid, peerUid, latest, count: msgs.length });
      });
      return convos.sort((a, b) => b.latest.ts - a.latest.ts);
    },

    seedDemoMessages(currentUid) {
      const m = this._store();
      const pairs = [
        ['u_artbot',    'Hey! Love your puzzles! 🎨'],
        ['u_puzzlepro', 'Can we do a puzzle collab? 🧩'],
        ['u_pixelqueen','Your solve time is insane! ⚡'],
      ];
      pairs.forEach(([peerUid, text]) => {
        const cid = this.chatId(currentUid, peerUid);
        if (!m[cid]) {
          m[cid] = [{
            id: peerUid + '_seed',
            senderUid: peerUid, receiverUid: currentUid,
            text, ts: Date.now() - Math.random() * 864e5
          }];
        }
      });
      this._save(m);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// PUZZLE ENGINE
// ═══════════════════════════════════════════════════════════
let G = {}, dragState = null, dragRafId = null, prevGroupCount = 0;

// Derangement shuffle: guarantees NO element stays in its original index
function derangeShuffle(n) {
  const arr = Array.from({length:n}, (_,i) => i);
  // Fisher-Yates then fix any fixed-points
  for (let i = n-1; i > 0; i--) {
    const j = Math.floor(Math.random() * i); // j < i guarantees arr[i] !== i at step i
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Final pass: if arr[0]===0 swap with random other
  if (arr[0] === 0) {
    const k = 1 + Math.floor(Math.random() * (n-1));
    [arr[0], arr[k]] = [arr[k], arr[0]];
  }
  return arr;
}

// ─── JIGSAW CLIP-PATH ────────────────────────────────────
function jigsawClip(top, right, bottom, left) {
  const K = 22, pts = [];
  const edge = (dir, val, pts) => {
    if (dir === 't') {
      pts.push('0% 0%');
      if (val) pts.push(`${50-K/2}% 0%`,`${50-K/2}% ${val>0?-K:K}%`,`${50+K/2}% ${val>0?-K:K}%`,`${50+K/2}% 0%`);
      pts.push('100% 0%');
    } else if (dir === 'r') {
      if (!val) { pts.push('100% 100%'); return; }
      const off = val>0 ? 100+K : 100-K;
      pts.push(`100% ${50-K/2}%`,`${off}% ${50-K/2}%`,`${off}% ${50+K/2}%`,`100% ${50+K/2}%`,'100% 100%');
    } else if (dir === 'b') {
      if (!val) { pts.push('0% 100%'); return; }
      const off = val>0 ? 100+K : 100-K;
      pts.push(`${50+K/2}% 100%`,`${50+K/2}% ${off}%`,`${50-K/2}% ${off}%`,`${50-K/2}% 100%`,'0% 100%');
    } else if (dir === 'l' && val) {
      const off = val>0 ? -K : K;
      pts.push(`0% ${50+K/2}%`,`${off}% ${50+K/2}%`,`${off}% ${50-K/2}%`,`0% ${50-K/2}%`);
    }
  };
  edge('t',top,pts); edge('r',right,pts); edge('b',bottom,pts); edge('l',left,pts);
  return `polygon(${pts.join(', ')})`;
}

// ─── HELPERS ─────────────────────────────────────────────
function computeSize(cols, rows) {
  // Integer piece size; container is exactly divisible by grid
  const maxW = Math.floor(Math.min(window.innerWidth * 0.88, 360));
  const pw = Math.floor(maxW / cols);
  const ph = pw;  // square cells
  return { pieceW: pw, pieceH: ph, containerW: pw * cols, containerH: ph * rows };
}

function buildSlots(cols, rows, pw, ph) {
  return Array.from({length:cols*rows}, (_,i) => ({ x:(i%cols)*pw, y:Math.floor(i/cols)*ph }));
}

function getSubTypes(shape) { return shape === 'triangle' ? ['tri-a','tri-b'] : ['solid']; }

function triClass(sub, slot, cols) {
  const even = ((slot%cols) + Math.floor(slot/cols)) % 2 === 0;
  return sub === 'tri-a' ? (even?'tri-tl':'tri-tr') : (even?'tri-br':'tri-bl');
}

// ─── GRID MATRIX ─────────────────────────────────────────
function buildMatrix() {
  G.gridMatrix = {};
  getSubTypes(G.shape).forEach(sub => { G.gridMatrix[sub] = new Array(G.cols*G.rows).fill(null); });
  G.pieces.forEach(p => { G.gridMatrix[p.subType][p.currentSlot] = p.id; });
}
function matrixSet(sub, slot, id) { if (G.gridMatrix?.[sub]) G.gridMatrix[sub][slot] = id; }
function matrixGet(sub, slot) { return G.gridMatrix?.[sub]?.[slot] ?? null; }

// ─── PIECE STYLING — seamless, zero-gap, 1px overlap ──
function applyPieceStyle(piece) {
  const { inner, homeSlot, subType, currentSlot } = piece;
  const { shape, cols, rows, containerW, containerH, pieceW, pieceH, image, hEdges, vEdges } = G;

  // Source position in the full image (integer pixels)
  const bx = (homeSlot % cols) * pieceW;
  const by = Math.floor(homeSlot / cols) * pieceH;

  if (shape === 'jigsaw') {
    const pad = Math.round(pieceW * 0.25);
    Object.assign(inner.style, {
      top: -pad+'px', left: -pad+'px',
      width: (pieceW + 2*pad)+'px', height: (pieceH + 2*pad)+'px',
      backgroundImage: image,
      backgroundSize: `${containerW}px ${containerH}px`,
      backgroundPosition: `${-(bx-pad)}px ${-(by-pad)}px`,
    });
    const r = Math.floor(homeSlot/cols), c = homeSlot%cols;
    inner.style.clipPath = jigsawClip(
      r===0 ? 0 : -(hEdges[r-1][c]||0),
      c===cols-1 ? 0 : (vEdges[r][c]||0),
      r===rows-1 ? 0 : (hEdges[r][c]||0),
      c===0 ? 0 : -(vEdges[r][c-1]||0)
    );
    if (piece.wrap) piece.wrap.style.overflow = 'visible';
  } else {
    // Square / Rectangle / Triangle — seamless, with 1px overlap to kill seams
    if (shape === 'triangle') {
      inner.className = `piece-inner ${triClass(subType, currentSlot, cols)}`;
      inner.style.touchAction = 'none';
      inner.style.userSelect = 'none';
    }
    // Extend inner by 1px on each edge to overlap neighbours and hide sub-pixel seams
    const OV = 1; // overlap amount in px
    Object.assign(inner.style, {
      top:  (-OV) + 'px',
      left: (-OV) + 'px',
      width:  (pieceW  + 2*OV) + 'px',
      height: (pieceH + 2*OV) + 'px',
      backgroundImage: image,
      backgroundSize: `${containerW}px ${containerH}px`,
      backgroundPosition: `${-(bx - OV)}px ${-(by - OV)}px`,
      borderRadius: '0px',
      border: 'none',
      outline: 'none',
      boxShadow: 'none',
    });
  }
}

function createPieceEl(piece) {
  const wrap = document.createElement('div');
  wrap.className = 'piece-wrap';
  // overflow:visible so the 1px overlap bleeds into neighbours
  wrap.style.cssText = `width:${G.pieceW}px;height:${G.pieceH}px;overflow:visible;pointer-events:auto;`;
  wrap.dataset.pid = piece.id;

  const inner = document.createElement('div');
  inner.className = 'piece-inner';
  inner.style.cssText = 'pointer-events:auto;touch-action:none;user-select:none;image-rendering:auto;';
  wrap.appendChild(inner);

  piece.wrap = wrap; piece.inner = inner;
  applyPieceStyle(piece);
  inner.addEventListener('pointerdown', e => onPointerDown(e, piece));
  return wrap;
}

function positionPiece(p) {
  const s = G.slots[p.currentSlot];
  // Use left/top for static positioning — avoids GPU compositing-layer seams
  p.wrap.style.left = s.x + 'px';
  p.wrap.style.top = s.y + 'px';
  p.wrap.style.transform = '';
}

function buildGrid() {
  const grid = document.getElementById('puzzle-grid');
  grid.innerHTML = '';
  grid.className = 'puzzle-grid';
  grid.style.width = G.containerW+'px';
  grid.style.height = G.containerH+'px';
  // No background image on grid — it would show the solved image
  // through gaps between shuffled pieces, creating a duplication effect
  grid.style.backgroundImage = 'none';

  if (DEBUG) {
    grid.classList.add('debug-mode');
    grid.style.setProperty('--debug-cell-w', G.pieceW+'px');
    grid.style.setProperty('--debug-cell-h', G.pieceH+'px');
  }

  const overlay = document.createElement('div');
  overlay.className = 'win-overlay';
  overlay.style.backgroundImage = G.image;
  overlay.style.backgroundSize = `${G.containerW}px ${G.containerH}px`;
  grid.appendChild(overlay);

  G.pieces.forEach(p => { grid.appendChild(createPieceEl(p)); positionPiece(p); });
}

// ─── GAME START ──────────────────────────────────────────
function getDynamicImageUrl(level) {
  if (level < 5) {
    const local = [
      'assets/levels/media__1776434033947.jpg',
      'assets/levels/media__1776434034979.jpg',
      'assets/levels/media__1776434035548.jpg',
      'assets/levels/media__1776434036559.jpg'
    ];
    return local[level % local.length];
  }
  const categories = [
    "aesthetic wallpaper",
    "sports car",
    "cyberpunk city",
    "sunset beach",
    "mountain landscape hd",
    "neon city lights",
    "luxury interior",
    "modern architecture"
  ];
  const category = categories[level % categories.length];
  return `https://source.unsplash.com/600x600/?${category}&sig=${level}`;
}

function preloadImage(url, timeoutMs = 2000, targetRatio = 1) {
  return new Promise(resolve => {
    let settled = false;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[PUZZLE] Image preload timed out (${timeoutMs}ms):`, url);
        resolve({ success: false });
      }
    }, timeoutMs);

    img.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try {
          if (!img.width || !img.height) {
            console.warn('[PUZZLE] Image dimensions invalid (0x0).');
            return resolve({ success: false });
          }
          const imgRatio = img.width / img.height;
          let sW = img.width, sH = img.height;
          let sX = 0, sY = 0;
          
          if (imgRatio > targetRatio) {
            // Image is wider
            sW = img.height * targetRatio;
            sX = (img.width - sW) / 2;
          } else {
            // Image is taller
            sH = img.width / targetRatio;
            sY = (img.height - sH) / 2;
          }
          
          const canvas = document.createElement('canvas');
          const maxDim = 800; // max high-res puzzle dimension
          if (targetRatio >= 1) {
            canvas.width = maxDim;
            canvas.height = maxDim / targetRatio;
          } else {
            canvas.height = maxDim;
            canvas.width = maxDim * targetRatio;
          }
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sX, sY, sW, sH, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          resolve({ success: true, url: dataUrl });
        } catch(e) {
          console.warn('[PUZZLE] Canvas crop failed or tainted. Aborting to fallback image:', e);
          resolve({ success: false });
        }
      }
    };
    
    img.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.warn('[PUZZLE] Image preload failed:', err);
        resolve({ success: false });
      }
    };
    
    img.src = url;
  });
}

async function startGame(cfg) {
  let { shape, level, customCfg } = cfg || {};
  
  if (!shape || !SHAPES.includes(shape)) shape = 'square';
  // Level Validation
  level = parseInt(level, 10);
  if (isNaN(level) || level < 0 || level >= TOTAL_LEVELS) {
    console.warn(`[PUZZLE] Invalid level index ${level}, falling back to level 0`);
    level = 0;
  }
  
  // Ensure level object exists
  let lvl = LEVELS[level];
  if (!lvl) {
    console.warn(`[PUZZLE] Level data missing for index ${level}, falling back to level 0`);
    lvl = LEVELS[0];
  }

  const fallbackBackground = `url('https://picsum.photos/600/600')`;
  let image = fallbackBackground;
  let baseSize = 3, isCustom = false;
  
  try {
    let rawSize = customCfg ? (customCfg.size || 3) : (lvl.size || 3);
    let rawShape = customCfg ? (customCfg.shape || 'square') : shape;
    if (rawShape === 'triangle' && rawSize > TRIANGLE_MAX) rawShape = 'square';
    
    let tCols = rawSize;
    let tRows = rawShape === 'rectangle' ? rawSize + 1 : rawSize;
    let targetRatio = tCols / tRows;

    if (customCfg) {
      isCustom = true;
      baseSize = rawSize;
      shape = rawShape;
      
      let rawStr = customCfg.image || fallbackBackground;
      let urlMatch = rawStr.match(/url\(['"]?(.*?)['"]?\)/);
      let extractedUrl = urlMatch ? urlMatch[1] : rawStr;
      
      const res = await preloadImage(extractedUrl, 2000, targetRatio);
      if (res.success && res.url) {
        image = `url('${res.url}')`;
      } else {
        console.warn('[PUZZLE] Custom image failed to load properly. Using fallback.');
        image = fallbackBackground;
      }
    } else {
      baseSize = rawSize;
      shape = rawShape;
      
      const dynamicUrl = getDynamicImageUrl(level);
      const res = await preloadImage(dynamicUrl, 2000, targetRatio);
      if (res.success && res.url) {
        image = `url('${res.url}')`;
      } else {
        console.warn('[PUZZLE] Dynamic image failed to load properly. Using fallback.');
        image = fallbackBackground;
      }
    }
  } catch (err) {
    console.error('[PUZZLE] Error during level configuration/preloading. Failsafe triggered:', err);
    image = fallbackBackground; // Ensure default image is strictly assigned
  }
  
  // Outer try-catch protecting engine construction and global state mutations
  try {
    if (!baseSize || baseSize < 3 || isNaN(baseSize)) baseSize = 3;

    const cols = baseSize, rows = shape === 'rectangle' ? baseSize + 1 : baseSize;
    const { pieceW, pieceH, containerW, containerH } = computeSize(cols, rows);

    let hEdges = [], vEdges = [];
    if (shape === 'jigsaw') {
      for (let r = 0; r < rows - 1; r++) hEdges.push(Array.from({length:cols}, () => Math.random() > .5 ? 1 : -1));
      for (let r = 0; r < rows; r++) vEdges.push(Array.from({length:cols-1}, () => Math.random() > .5 ? 1 : -1));
    }

    G = { shape, cols, rows, image, pieceW, pieceH, containerW, containerH,
      hEdges, vEdges, isCustom, level, levelShape: cfg?.shape || shape,
      pieces: [], slots: buildSlots(cols, rows, pieceW, pieceH), isWon: false };

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

    // ── Validation: ensure unique slices per subType ──
    if (DEBUG) {
      const byType = {};
      G.pieces.forEach(p => {
        (byType[p.subType] ??= { homes: new Set(), currents: new Set() });
        const t = byType[p.subType];
        if (t.homes.has(p.homeSlot)) console.warn(`[PUZZLE] Duplicate homeSlot ${p.homeSlot} in ${p.subType}`);
        if (t.currents.has(p.currentSlot)) console.warn(`[PUZZLE] Duplicate currentSlot ${p.currentSlot} in ${p.subType}`);
        t.homes.add(p.homeSlot);
        t.currents.add(p.currentSlot);
      });
      console.log(`[PUZZLE] ${G.pieces.length} pieces, ${cols}×${rows}, shape=${shape}`);
    }

    const label = document.getElementById('game-label');
    if (label) label.textContent = isCustom ? `CUSTOM ${cols}×${rows}` : `LEVEL ${level + 1} · ${cols}×${rows}`;

    buildGrid(); Timer.reset(); buildMatrix(); recalculateGroups();
    prevGroupCount = new Set(G.pieces.map(p => p.groupId)).size;
    
  } catch (criticalErr) {
    console.error('[PUZZLE] CRITICAL ENGINE ERROR. Generated failsafe catch.', criticalErr);
  }
}

// ─── GROUP SYSTEM (BFS) ──────────────────────────────────
function offsetOf(p) {
  return { dc: (p.currentSlot%G.cols)-(p.homeSlot%G.cols), dr: Math.floor(p.currentSlot/G.cols)-Math.floor(p.homeSlot/G.cols) };
}

function recalculateGroups() {
  const grid = document.getElementById('puzzle-grid');
  grid.querySelectorAll('.group-wrap').forEach(w => {
    w.querySelectorAll('.piece-wrap').forEach(pw => grid.appendChild(pw));
    w.remove();
  });
  G.pieces.forEach(p => { p.groupId = null; });

  const slotMap = {};
  G.pieces.forEach(p => { (slotMap[p.subType]??={})[p.currentSlot] = p; });

  const visited = new Set();
  let nextId = 0;

  G.pieces.forEach(startP => {
    const key = `${startP.subType}_${startP.id}`;
    if (visited.has(key)) return;
    const {dc:dc0, dr:dr0} = offsetOf(startP);
    const queue = [startP], comp = [];

    while (queue.length) {
      const p = queue.shift();
      const pk = `${p.subType}_${p.id}`;
      if (visited.has(pk)) continue;
      visited.add(pk); comp.push(p);

      const pc = p.currentSlot%G.cols, pr = Math.floor(p.currentSlot/G.cols);
      for (const [nc,nr] of [[pc+1,pr],[pc-1,pr],[pc,pr+1],[pc,pr-1]]) {
        if (nc<0||nc>=G.cols||nr<0||nr>=G.rows) continue;
        const n = slotMap[p.subType]?.[nr*G.cols+nc];
        if (!n || visited.has(`${n.subType}_${n.id}`)) continue;
        const {dc,dr} = offsetOf(n);
        if (dc===dc0 && dr===dr0) queue.push(n);
      }
      if (G.shape === 'triangle') {
        const csub = p.subType==='tri-a'?'tri-b':'tri-a';
        const n = slotMap[csub]?.[p.currentSlot];
        if (n && !visited.has(`${n.subType}_${n.id}`)) {
          const {dc,dr} = offsetOf(n);
          if (dc===dc0 && dr===dr0) queue.push(n);
        }
      }
    }
    const gid = nextId++;
    comp.forEach(p => { p.groupId = gid; });
  });

  const byGroup = {};
  G.pieces.forEach(p => { (byGroup[p.groupId]??=[]).push(p); });
  Object.values(byGroup).forEach(members => {
    const wrap = document.createElement('div');
    wrap.className = 'group-wrap';
    grid.appendChild(wrap);
    members.forEach(p => wrap.appendChild(p.wrap));
  });
}

// ─── DRAG ────────────────────────────────────────────────
function onPointerDown(e, piece) {
  if (dragState || (e.button!==undefined && e.button!==0 && e.pointerType==='mouse')) return;
  e.preventDefault();
  Timer.startIfFirst(); Audio.play('drag'); haptic(10);

  const members = G.pieces.filter(p => p.groupId === piece.groupId);
  const groupWrap = piece.wrap.parentElement;

  members.forEach(p => { const s = G.slots[p.currentSlot]; p._dsx = s.x; p._dsy = s.y; });

  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  members.forEach(p => {
    minX=Math.min(minX,p._dsx); minY=Math.min(minY,p._dsy);
    maxX=Math.max(maxX,p._dsx+G.pieceW); maxY=Math.max(maxY,p._dsy+G.pieceH);
  });

  groupWrap.classList.add('dragging');
  members.forEach(p => p.wrap.classList.add('dragging'));

  dragState = { piece, members, groupWrap,
    startX:e.clientX, startY:e.clientY, dx:0, dy:0,
    minDX:-minX, maxDX:G.containerW-maxX, minDY:-minY, maxDY:G.containerH-maxY };

  e.currentTarget.setPointerCapture(e.pointerId);
  document.addEventListener('pointermove', onPointerMove, {passive:false});
  document.addEventListener('pointerup', onPointerUp, {passive:false});
  document.addEventListener('pointercancel', onPointerUp, {passive:false});
  dragRafId = requestAnimationFrame(dragLoop);
}

function onPointerMove(e) {
  if (!dragState) return; e.preventDefault();
  dragState.dx = Math.max(dragState.minDX, Math.min(e.clientX-dragState.startX, dragState.maxDX));
  dragState.dy = Math.max(dragState.minDY, Math.min(e.clientY-dragState.startY, dragState.maxDY));
}

function dragLoop() {
  if (!dragState) return;
  dragState.groupWrap.style.transform = `translate(${dragState.dx}px,${dragState.dy}px)`;
  dragRafId = requestAnimationFrame(dragLoop);
}

function onPointerUp() {
  if (!dragState) return;
  cancelAnimationFrame(dragRafId); dragRafId = null;
  const { piece, members, groupWrap, dx, dy } = dragState;

  // Bake positions before clearing group transform
  members.forEach(p => {
    const s = G.slots[p.currentSlot];
    p.wrap.style.transition = 'none';
    p.wrap.style.transform = `translate(${Math.round(dx)}px,${Math.round(dy)}px)`;
  });
  groupWrap.style.transform = '';
  groupWrap.classList.remove('dragging');
  members.forEach(p => p.wrap.classList.remove('dragging'));

  // Find target cell
  const slot = G.slots[piece.currentSlot];
  const tCol = Math.max(0, Math.min(G.cols-1, Math.round((slot.x+dx)/G.pieceW)));
  const tRow = Math.max(0, Math.min(G.rows-1, Math.round((slot.y+dy)/G.pieceH)));
  const colShift = tCol - (piece.currentSlot%G.cols);
  const rowShift = tRow - Math.floor(piece.currentSlot/G.cols);

  let movedIds = new Set(members.map(p=>p.id)), swapped = false;
  if (colShift||rowShift) {
    const r = executeSwap(members, colShift, rowShift);
    swapped = r.success; r.movedIds.forEach(id => movedIds.add(id));
  }

  if (swapped) {
    Audio.play('swap'); haptic(20);
    if (G.shape==='triangle') G.pieces.forEach(p => {
      if (movedIds.has(p.id)) p.inner.className = `piece-inner ${triClass(p.subType,p.currentSlot,G.cols)}`;
    });
  }

  // Animate to final positions using transform, then snap to left/top
  requestAnimationFrame(() => {
    G.pieces.forEach(p => {
      if (!movedIds.has(p.id)) return;
      const s = G.slots[p.currentSlot];
      // Animate via transform from current visual position to final
      p.wrap.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
      p.wrap.style.transform = '';
      p.wrap.style.left = s.x + 'px';
      p.wrap.style.top = s.y + 'px';
    });
    // After animation, clear transform and settle on left/top
    setTimeout(() => movedIds.forEach(id => {
      const p = G.pieces.find(x=>x.id===id);
      if (p) {
        p.wrap.style.transition = '';
        p.wrap.style.transform = '';
      }
    }), 220);
  });

  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  dragState = null;

  setTimeout(() => {
    recalculateGroups();
    const newCount = new Set(G.pieces.map(p=>p.groupId)).size;
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
    checkWin();
  }, 250);
}

// ─── SWAP ENGINE ─────────────────────────────────────────
function executeSwap(members, colShift, rowShift) {
  const {cols, rows} = G, memberIds = new Set(members.map(p=>p.id)), movedIds = new Set();

  const dragMoves = [];
  for (const p of members) {
    const nc = (p.currentSlot%cols)+colShift, nr = Math.floor(p.currentSlot/cols)+rowShift;
    if (nc<0||nc>=cols||nr<0||nr>=rows) return {success:false, movedIds};
    dragMoves.push({piece:p, fromSlot:p.currentSlot, toSlot:nr*cols+nc});
  }

  const displacedMoves = [];
  for (const sub of getSubTypes(G.shape)) {
    const subMoves = dragMoves.filter(m => m.piece.subType===sub);
    if (!subMoves.length) continue;
    const subFrom = new Set(subMoves.map(m=>m.fromSlot)), subTo = new Set(subMoves.map(m=>m.toSlot));
    const vacated = [...subFrom].filter(s=>!subTo.has(s)).sort((a,b)=>a-b);
    const occupied = [...subTo].filter(s=>!subFrom.has(s)).sort((a,b)=>a-b);
    if (occupied.length > vacated.length) return {success:false, movedIds};
    for (let i=0; i<occupied.length; i++) {
      const oid = matrixGet(sub, occupied[i]);
      if (oid!==null && !memberIds.has(oid)) {
        const occ = G.pieces.find(p=>p.id===oid);
        if (occ) displacedMoves.push({piece:occ, fromSlot:occupied[i], toSlot:vacated[i]});
      }
    }
  }

  const allMoves = [...dragMoves,...displacedMoves];
  const destKeys = allMoves.map(m=>`${m.piece.subType}_${m.toSlot}`);
  if (new Set(destKeys).size !== destKeys.length) return {success:false, movedIds};

  // Atomic commit
  allMoves.forEach(m => { m.piece._ns = m.toSlot; });
  allMoves.forEach(m => matrixSet(m.piece.subType, m.fromSlot, null));
  allMoves.forEach(m => {
    m.piece.currentSlot = m.piece._ns; delete m.piece._ns;
    matrixSet(m.piece.subType, m.piece.currentSlot, m.piece.id);
    movedIds.add(m.piece.id);
  });
  return {success:true, movedIds};
}

// ─── WIN ─────────────────────────────────────────────────
function checkWin() {
  if (G.isWon || !G.pieces.every(p => p.currentSlot===p.homeSlot)) return;
  G.isWon = true; Timer.pause();
  document.getElementById('puzzle-grid').classList.add('won');

  const elapsed = Timer.elapsed, key = `${G.levelShape}_${G.level}`;
  const prev = Save.data.bestTimes[key];
  const isNew = !prev || elapsed < prev;
  if (isNew && !G.isCustom) Save.data.bestTimes[key] = elapsed;
  if (!G.isCustom && G.level+1 > (Save.data.progress[G.levelShape]||0))
    Save.data.progress[G.levelShape] = G.level+1;
  Save.flush();

  Audio.play('win'); haptic(200); spawnConfetti();
  setTimeout(() => {
    document.getElementById('victory-time').textContent = `Time: ${fmtTime(elapsed)}`;
    const bestEl = document.getElementById('victory-best');
    bestEl.textContent = isNew && prev ? '🏅 New Best Time!' : prev ? `Best: ${fmtTime(prev)}` : '';
    openModal('modal-victory');
    document.getElementById('btn-next-level').classList.toggle('hidden', G.isCustom || G.level >= TOTAL_LEVELS-1);
  }, 800);
}

// ─── MODALS / TOAST / CONFETTI ───────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(msg, color='#ef4444') {
  const t = document.createElement('div');
  t.className = 'toast-notification'; t.textContent = msg; t.style.background = color;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(()=>t.remove(),300); }, 2500);
}

function spawnConfetti() {
  const c = document.createElement('div'); c.className = 'confetti-container';
  document.body.appendChild(c);
  const colors = ['#6c63ff','#a855f7','#f5a623','#ff6b6b','#22c55e','#ff8e53','#38bdf8'];
  for (let i=0; i<60; i++) {
    const p = document.createElement('div'); p.className = 'confetti';
    p.style.left = Math.random()*100+'%';
    p.style.background = colors[i%colors.length];
    p.style.setProperty('--fall-duration',(2+Math.random()*2)+'s');
    p.style.setProperty('--fall-delay',(Math.random()*.8)+'s');
    p.style.width = (6+Math.random()*8)+'px'; p.style.height = p.style.width;
    p.style.borderRadius = Math.random()>.5?'50%':'2px';
    c.appendChild(p);
  }
  setTimeout(() => c.remove(), 5000);
}

// ─── UI RENDERERS ────────────────────────────────────────
function renderHome() {
  const badge = document.getElementById('daily-badge');
  if (badge) badge.textContent = Save.data.daily[new Date().toDateString()] ? '✓' : 'NEW';
}

function renderShapeSelect() {
  SHAPES.forEach(sh => { const el=document.getElementById(`prog-${sh}`); if(el) el.textContent=`${Save.data.progress[sh]||0} / 350`; });
}

let _campaignShape = 'square';

function renderLevelMap(data) {
  if (data?.shape) _campaignShape = data.shape;
  const grid = document.getElementById('levels-grid');
  const title = document.getElementById('levels-title');
  grid.innerHTML = '';
  if (title) title.textContent = _campaignShape.toUpperCase();
  const unlocked = Save.data.progress[_campaignShape] || 0;

  for (let i=0; i<TOTAL_LEVELS; i++) {
    const btn = document.createElement('div');
    btn.className = 'level-tile';
    const done = i<unlocked, current = i===unlocked, locked = i>unlocked;
    if (done) { btn.classList.add('done'); btn.textContent = '✓'; }
    if (current) { btn.classList.add('current'); btn.textContent = i+1; }
    if (locked) { btn.classList.add('locked'); btn.textContent = '🔒'; }
    if (!done && !current && !locked) btn.textContent = i+1;
    if (!locked) btn.addEventListener('click', () => Nav.go('screen-game', {shape:_campaignShape, level:i}));
    grid.appendChild(btn);
  }
}

function renderProfile() {
  const myUid = DB.users.ensureCurrentUser();
  const u = Save.data.username || 'Player';
  const lk = Community.getPublic().filter(p=>p.creator===u).reduce((s,p)=>s+(p.likes||0),0);
  document.getElementById('profile-username').textContent = u;
  document.getElementById('profile-total').textContent = `${Save.totalSolved()} puzzles solved`;
  document.getElementById('stat-followers').textContent = DB.follows.followersOf(myUid);
  document.getElementById('stat-following').textContent = DB.follows.followingOf(myUid);
  document.getElementById('stat-likes').textContent = lk;
  document.getElementById('stat-created').textContent = Community.getUser().length;
  SHAPES.forEach(sh => { const el=document.getElementById(`prof-${sh}`); if(el) el.textContent=`${Save.data.progress[sh]||0}/350`; });
  const gallery = document.getElementById('profile-gallery');
  gallery.innerHTML = '';
  Community.getUser().filter(p=>p.creator===u).forEach(p => gallery.appendChild(buildGalleryCard(p)));
  if (!gallery.children.length) gallery.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:20px 0">No uploads yet.</p>';
}

function renderPublicProfile(username) {
  const myUid    = DB.users.ensureCurrentUser();
  const peer     = DB.users.findByName(username);
  const peerUid  = peer?.uid || null;

  document.getElementById('pub-username').textContent = username || 'Player';
  document.getElementById('pub-avatar').textContent   = peer?.avatar || '👤';
  if (peerUid) document.getElementById('pub-uid').textContent = peerUid;

  // Social counts
  document.getElementById('pub-stat-followers').textContent =
    peerUid ? DB.follows.followersOf(peerUid) : '—';
  document.getElementById('pub-stat-following').textContent =
    peerUid ? DB.follows.followingOf(peerUid) : '—';

  // Follow button
  const followBtn = document.getElementById('btn-follow');
  const isMe = username === (Save.data.username || 'Player');
  if (isMe) {
    followBtn.textContent = 'That\'s You!';
    followBtn.disabled = true;
  } else {
    const following = peerUid ? DB.follows.isFollowing(myUid, peerUid) : false;
    followBtn.textContent = following ? 'UNFOLLOW' : 'FOLLOW';
    followBtn.disabled = false;
    followBtn.onclick = () => {
      if (!peerUid) return;
      const now = DB.follows.toggle(myUid, peerUid);
      followBtn.textContent = now ? 'UNFOLLOW' : 'FOLLOW';
      document.getElementById('pub-stat-followers').textContent = DB.follows.followersOf(peerUid);
      renderProfile(); // refresh own counts if on profile
    };
  }

  // Message button
  const msgBtn = document.getElementById('btn-message-user');
  msgBtn.onclick = () => {
    if (!peerUid) { showToast('User not found'); return; }
    Nav.go('screen-chat', { peerUid });
  };

  // Puzzle gallery
  const gallery = document.getElementById('pub-gallery');
  gallery.innerHTML = '';
  Community.getPublic().filter(p=>p.creator===username).forEach(p => gallery.appendChild(buildGalleryCard(p)));
  if (!gallery.children.length)
    gallery.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:20px 0">No uploads yet.</p>';
}

function buildGalleryCard(puzzle) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const liked = Community.isLiked(puzzle.id);
  card.innerHTML = `
    <div class="gallery-thumb" style="background-image:${puzzle.image}"></div>
    <div class="gallery-info">
      <h4>${puzzle.title||puzzle.shape||'Puzzle'}</h4>
      <p><span class="creator-link" data-creator="${puzzle.creator}">${puzzle.creator}</span> · ${puzzle.shape} ${puzzle.size}×${puzzle.size}</p>
      <div class="gallery-likes">
        <button class="like-btn ${liked?'liked':''}" data-id="${puzzle.id}">♥</button>
        <span class="like-count" id="lc-${puzzle.id}">${puzzle.likes||0}</span>
      </div>
    </div>`;
  // Creator name → public profile
  card.querySelector('.creator-link').addEventListener('click', ev => {
    ev.stopPropagation();
    Nav.go('screen-public-profile', { username: puzzle.creator });
  });
  card.querySelector('.like-btn').addEventListener('click', ev => {
    ev.stopPropagation();
    const now = Community.toggleLike(puzzle.id);
    ev.target.classList.toggle('liked', now);
    const lc = document.getElementById(`lc-${puzzle.id}`);
    if (lc) lc.textContent = (parseInt(lc.textContent)||0) + (now?1:-1);
  });
  card.addEventListener('click', () => Nav.go('screen-game', {
    shape:puzzle.shape, level:0,
    customCfg:{image:puzzle.image, size:puzzle.size, shape:puzzle.shape}
  }));
  return card;
}

function renderCommunity() {
  Community.seed();
  const myUid = DB.users.ensureCurrentUser();
  const followedNames = DB.follows.followingNames(myUid);
  const feed = document.getElementById('community-feed');
  const tab  = document.querySelector('.feed-tab.active');
  const mode = tab?.dataset.tab || 'all';
  feed.innerHTML = '';
  let items = Community.getPublic();
  if (mode === 'following') {
    items = items.filter(p => followedNames.includes(p.creator));
  } else {
    const pri  = items.filter(p =>  followedNames.includes(p.creator));
    const rest = items.filter(p => !followedNames.includes(p.creator));
    items = [...pri, ...rest];
  }
  if (!items.length) {
    feed.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:20px 0;text-align:center">No puzzles found.</p>';
    return;
  }
  items.forEach(p => feed.appendChild(buildGalleryCard(p)));
}

// ─── MESSAGES INBOX ──────────────────────────────────────
function fmtMsgTime(ts) {
  const d = new Date(ts), now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h';
  return d.toLocaleDateString(undefined, {month:'short', day:'numeric'});
}

function renderMessages() {
  const myUid = DB.users.ensureCurrentUser();
  const list  = document.getElementById('messages-list');
  const empty = document.getElementById('messages-empty');
  list.innerHTML = '';

  const convos = DB.messages.getConversations(myUid);
  if (!convos.length) {
    list.classList.add('hidden'); empty.classList.remove('hidden'); return;
  }
  list.classList.remove('hidden'); empty.classList.add('hidden');

  convos.forEach(({ peerUid, latest }) => {
    const peer = DB.users.get(peerUid);
    if (!peer) return;
    const isMine = latest.senderUid === myUid;
    const item = document.createElement('div');
    item.className = 'msg-preview-item';
    item.innerHTML = `
      <div class="msg-preview-avatar">${peer.avatar || '👤'}</div>
      <div class="msg-preview-body">
        <div class="msg-preview-name">${peer.username}</div>
        <div class="msg-preview-text">${isMine ? 'You: ' : ''}${latest.text}</div>
      </div>
      <div class="msg-preview-time">${fmtMsgTime(latest.ts)}</div>`;
    item.addEventListener('click', () => Nav.go('screen-chat', { peerUid }));
    list.appendChild(item);
  });
}

// ─── CHAT (1-to-1) ───────────────────────────────────────
let _chatPeerUid = null;

function renderChat(peerUid) {
  _chatPeerUid = peerUid;
  const myUid = DB.users.ensureCurrentUser();
  const peer  = DB.users.get(peerUid);

  // Set topbar
  document.getElementById('chat-peer-avatar').textContent = peer?.avatar || '👤';
  document.getElementById('chat-peer-name').textContent   = peer?.username || 'User';

  // Render messages
  _renderChatMessages(myUid, peerUid);

  // Focus input
  setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
}

function _renderChatMessages(myUid, peerUid) {
  const container = document.getElementById('chat-messages');
  const msgs = DB.messages.getChat(myUid, peerUid);
  container.innerHTML = '';

  if (!msgs.length) {
    container.innerHTML =
      '<div class="chat-empty"><div class="chat-empty-icon">💬</div><p>No messages yet.<br>Say hello!</p></div>';
    return;
  }

  let lastDate = null;
  msgs.forEach(msg => {
    const d = new Date(msg.ts).toDateString();
    if (d !== lastDate) {
      lastDate = d;
      const label = document.createElement('div');
      label.className = 'chat-date-label';
      label.textContent = new Date(msg.ts).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
      container.appendChild(label);
    }
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.senderUid === myUid ? 'mine' : 'theirs'}`;
    bubble.innerHTML = `${msg.text}<div class="chat-bubble-time">${fmtMsgTime(msg.ts)}</div>`;
    container.appendChild(bubble);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  const input  = document.getElementById('chat-input');
  const text   = input?.value.trim();
  if (!text || !_chatPeerUid) return;
  const myUid  = DB.users.ensureCurrentUser();
  DB.messages.send(myUid, _chatPeerUid, text);
  input.value = '';
  _renderChatMessages(myUid, _chatPeerUid);
  Audio.play('drag');
}

function renderDaily() {
  const now = new Date(), key = now.toDateString();
  const el = document.getElementById('daily-date-display');
  if (el) el.textContent = now.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  let streak = 0;
  for (let i=0; i<30; i++) { const d=new Date(now); d.setDate(d.getDate()-i); if(Save.data.daily[d.toDateString()]) streak++; else break; }
  const se = document.getElementById('daily-streak');
  if (se) se.textContent = `🔥 ${streak} day streak`;
  const cal = document.getElementById('daily-calendar');
  if (cal) {
    cal.innerHTML = '';
    for (let i=13; i>=0; i--) { const d=new Date(now); d.setDate(d.getDate()-i); const div=document.createElement('div'); div.className=`cal-day${Save.data.daily[d.toDateString()]?' done':''}`; div.textContent=d.getDate(); cal.appendChild(div); }
  }
  const done = !!Save.data.daily[key], btn = document.getElementById('btn-daily-play');
  if (btn) { btn.textContent = done ? '✓ Completed Today' : '▶ PLAY TODAY'; btn.disabled = done; }
}

function renderMaster() {
  const total = Save.totalSolved(), unlocked = total >= MASTER_UNLOCK;
  const hint = document.getElementById('master-unlock-hint');
  if (hint) hint.textContent = unlocked ? `${total} levels solved — Master unlocked!` : `Complete ${MASTER_UNLOCK} levels to unlock (${total}/${MASTER_UNLOCK})`;
  const grid = document.getElementById('master-grid');
  grid.innerHTML = '';
  const done = Save.data.masterDone || [];
  for (let i=0; i<MASTER_LEVELS; i++) {
    const btn = document.createElement('div');
    btn.className = 'level-tile';
    if (done.includes(i)) { btn.classList.add('done'); btn.textContent = '✓'; }
    else if (!unlocked) { btn.classList.add('locked'); btn.textContent = '🔒'; }
    else btn.textContent = 'M'+(i+1);
    if (unlocked) btn.addEventListener('click', () => {
      const size = Math.min(3+Math.floor(i/4),9), shape = SHAPES[i%SHAPES.length];
      Nav.go('screen-game', {shape, level:0, customCfg:{image:`url('https://picsum.photos/id/${500 + (i * 7) % 400}/400/400')`, size, shape, isMaster:true, masterIdx:i}});
    });
    grid.appendChild(btn);
  }
}

// ─── EVENT BINDING ───────────────────────────────────────
function bindEvents() {
  const $ = id => document.getElementById(id);
  const on = (id, fn) => $(id)?.addEventListener('click', fn);

  // Onboarding
  on('ob-submit', () => {
    const val = $('ob-input').value.trim(), err = $('ob-error');
    if (val.length<3) { err.textContent='Must be at least 3 characters'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden'); Save.data.username=val; Save.flush(); Nav.go('screen-home');
  });
  $('ob-input')?.addEventListener('keydown', e => { if(e.key==='Enter') $('ob-submit').click(); });

  // Home
  on('btn-play',           () => Nav.go('screen-shape-select'));
  on('btn-daily-home',     () => Nav.go('screen-daily'));
  on('btn-master-home',    () => Nav.go('screen-master'));
  on('btn-explore-home',   () => Nav.go('screen-explore'));
  on('btn-create-home',    () => Nav.go('screen-create'));
  on('btn-home-profile',   () => Nav.go('screen-profile'));
  on('btn-collection',     () => Nav.go('screen-shape-select'));
  on('btn-settings-home',  () => openModal('modal-settings'));
  on('btn-messages-home',  () => Nav.go('screen-messages'));

  // Chat back button
  on('chat-back', () => Nav.back());

  // Chat send
  on('chat-send', sendChatMessage);
  $('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

  // Public profile: message button (registered in renderPublicProfile via onclick)

  // Shape select
  document.querySelectorAll('.shape-tile').forEach(t => t.addEventListener('click', () => {
    _campaignShape = t.dataset.shape;
    document.querySelectorAll('.shape-tile').forEach(x => x.classList.remove('selected'));
    t.classList.add('selected');
    Nav.go('screen-levels', {shape:_campaignShape});
  }));

  // Levels & Game back
  on('levels-back', () => Nav.back());
  on('game-back', () => {
    if (G.pieces?.length && !G.isWon) openModal('modal-confirm-exit');
    else { Timer.pause(); Nav.back(); }
  });
  on('btn-confirm-exit', () => { closeModal('modal-confirm-exit'); Timer.pause(); Nav.back(); });
  on('btn-cancel-exit', () => closeModal('modal-confirm-exit'));

  // Game controls
  on('btn-reset', () => startGame({shape:G.levelShape||G.shape, level:G.level,
    customCfg: G.isCustom ? {image:G.image, size:G.cols, shape:G.shape} : null}));
  on('btn-hint', () => {
    const wrong = G.pieces.find(p => p.currentSlot!==p.homeSlot);
    if (!wrong) { showToast('All pieces are correct!','#22c55e'); return; }
    const target = G.pieces.find(p => p.homeSlot===wrong.currentSlot && p.currentSlot!==p.homeSlot) || wrong;
    if (target.wrap) { target.wrap.classList.add('hint-highlight'); setTimeout(()=>target.wrap.classList.remove('hint-highlight'),3200); }
    showToast('💡 This piece is misplaced!','#6c63ff');
  });
  on('game-settings-btn', () => openModal('modal-settings'));

  // Victory
  on('btn-next-level', () => {
    closeModal('modal-victory');
    const next = (G.level||0)+1;
    if (next<TOTAL_LEVELS) Nav.go('screen-game',{shape:G.levelShape||G.shape, level:next});
    else { showToast('🎉 All levels complete!','#22c55e'); Nav.back(); }
  });
  on('btn-replay', () => { closeModal('modal-victory'); startGame({shape:G.levelShape||G.shape, level:G.level, customCfg:G.isCustom?{image:G.image,size:G.cols,shape:G.shape}:null}); });
  on('btn-to-menu', () => { closeModal('modal-victory'); Nav.go('screen-home'); });

  // Settings
  on('btn-close-settings', () => closeModal('modal-settings'));
  $('toggle-sound')?.addEventListener('change', e => { Save.data.settings.sound=e.target.checked; Save.flush(); });
  $('toggle-haptic')?.addEventListener('change', e => { Save.data.settings.haptic=e.target.checked; Save.flush(); });

  // Generic back
  document.querySelectorAll('.back-btn').forEach(b => b.addEventListener('click', () => Nav.back()));

  // Profile
  on('btn-edit-username', () => {
    const n = prompt('New username (3–15 chars):');
    if (n?.trim().length>=3) { Save.data.username=n.trim().slice(0,15); Save.flush(); renderProfile(); }
  });

  // Community tabs
  document.querySelectorAll('.feed-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active'); renderCommunity();
  }));

  // Create
  const uploadZone = $('upload-zone'), uploadInput = $('image-upload');
  uploadZone?.addEventListener('click', () => uploadInput.click());
  uploadInput?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('upload-placeholder').classList.add('hidden');
      const preview = $('image-preview');
      preview.style.backgroundImage = `url('${ev.target.result}')`;
      preview.classList.remove('hidden');
      uploadZone.dataset.image = `url('${ev.target.result}')`;
    };
    reader.readAsDataURL(file);
  });
  on('btn-create-play', () => launchCustom(false));
  on('btn-create-publish', () => launchCustom(true));

  // Daily
  on('btn-daily-play', () => {
    Save.data.daily[new Date().toDateString()] = true; Save.flush();
    const now = new Date(), dayOfYear = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
    const dailyId = (dayOfYear * 13 + 17) % 900 + 50;  // unique photo per day, range 50-949
    Nav.go('screen-game', {shape:'square', level:0, customCfg:{image:`url('https://picsum.photos/id/${dailyId}/400/400')`, size:4, shape:'square', isDaily:true}});
    renderDaily();
  });

  // Visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Timer.pause();
    else if (Nav.current()==='screen-game' && !G.isWon) Timer.start();
  });
}

function launchCustom(publish) {
  const imageUrl = document.getElementById('upload-zone').dataset.image;
  if (!imageUrl) { showToast('Please upload an image first'); return; }
  const size = parseInt(document.getElementById('custom-size').value)||3;
  const shape = document.getElementById('custom-shape').value||'square';
  const puzzle = { id:'c_'+Date.now(), title:`Custom ${shape} ${size}×${size}`,
    creator:Save.data.username||'Player', image:imageUrl, size, shape, likes:0, ts:Date.now() };
  if (publish) { Community.publish(puzzle); showToast('Published! 🌍','#22c55e'); }
  Nav.go('screen-game', {shape, level:0, customCfg:{image:imageUrl, size, shape}});
}

// ─── BOOT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Save.load(); Audio.init();
  // Boot DB: seed demo users + ensure current player has a user record
  DB.users.seed();
  DB.users.ensureCurrentUser();
  // Seed demo messages on first run
  if (!DB._get('mosaic_msg_seeded')) {
    const myUid = DB.users.ensureCurrentUser();
    DB.messages.seedDemoMessages(myUid);
    DB._set('mosaic_msg_seeded', true);
  }
  bindEvents();
  document.getElementById('toggle-sound').checked = Save.data.settings.sound;
  document.getElementById('toggle-haptic').checked = Save.data.settings.haptic;
  Nav.go(Save.data.username ? 'screen-home' : 'screen-onboarding');

  // Music toggle
  const musicBtn = document.createElement('button');
  musicBtn.className = 'music-toggle';
  musicBtn.textContent = '🎵';
  musicBtn.addEventListener('click', () => {
    const p = Audio.toggleBGM();
    musicBtn.classList.toggle('playing',p);
    musicBtn.textContent = p?'🔊':'🎵';
    Save.data.settings.bgm = p; Save.flush();
  });
  document.body.appendChild(musicBtn);

  if (Save.data.settings.bgm) {
    document.addEventListener('pointerdown', function go() {
      Audio.startBGM(); musicBtn.classList.add('playing'); musicBtn.textContent='🔊';
      document.removeEventListener('pointerdown',go);
    }, {once:true});
  }

  // PWA install
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `<span class="install-banner-text">✨ Install Mosaic for the best experience!</span>
      <div class="install-banner-actions"><button class="btn btn-primary btn-sm" id="btn-install">Install</button>
      <button class="btn btn-ghost btn-sm" id="btn-dismiss-install">✕</button></div>`;
    document.body.appendChild(banner);
    document.getElementById('btn-install').addEventListener('click', () => { e.prompt(); banner.remove(); });
    document.getElementById('btn-dismiss-install').addEventListener('click', () => banner.remove());
  });
});
