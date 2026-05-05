'use strict';
/* ═══════════════════════════════════════════════════════════
   MOSAIC — ui.js
   Navigation stack · screen renderers · modals/toast/confetti
   · event binding · boot.
   NO puzzle engine logic, NO data storage.
   Depends on: config.js · db.js · game.js · social.js
   ═══════════════════════════════════════════════════════════ */

// ─── NAVIGATION ──────────────────────────────────────────
// Isolated stack: only Nav.go() / Nav.back() may switch screens.
// Game engine never touches nav; social never touches nav directly.
const Nav = {
  stack: [],

  // Set of screens that are temporarily disabled until social system is stable.
  // Remove IDs from here (and the .social-disabled class in HTML) to re-enable.
  _SOCIAL_SCREENS: new Set([
    'screen-explore', 'screen-public-profile', 'screen-messages', 'screen-chat',
  ]),

  go(id, data = {}) {
    // Guard: block navigation to social screens while they are disabled
    if (this._SOCIAL_SCREENS.has(id)) {
      showToast('Social features coming soon! 🚀', '#6c63ff');
      return;
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active'); el.scrollTop = 0;
    this.stack.push({ id, data });
    this._enter(id, data);
  },

  back() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    const prev = this.stack[this.stack.length - 1];
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(prev.id);
    if (el) { el.classList.add('active'); el.scrollTop = 0; }
    this._enter(prev.id, prev.data);
  },

  // Map of screen IDs → render functions.
  // Game and Social callbacks are resolved here so this file is the ONLY
  // place that knows the full screen → renderer mapping.
  _enter(id, data) {
    const handlers = {
      'screen-home':           _renderHome,
      'screen-shape-select':   _renderShapeSelect,
      'screen-levels':         () => _renderLevelMap(data),
      'screen-game':           () => startGame(data),        // game.js
      'screen-daily':          _renderDaily,
      'screen-master':         _renderMaster,
      'screen-create':         _resetCreate,
      'screen-leaderboard':    _renderLeaderboard,
      'screen-explore':        renderCommunity,               // social.js
      'screen-profile':        renderProfile,                 // social.js
      'screen-public-profile': () => renderPublicProfile(data.username), // social.js
      'screen-messages':       renderMessages,                // social.js
      'screen-chat':           () => renderChat(data.peerUid),           // social.js
    };
    (handlers[id] || (() => {}))();
  },

  current() { return this.stack.length ? this.stack[this.stack.length - 1].id : null; },
};

// ─── MODAL / TOAST / CONFETTI ────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function showToast(msg, color = '#ef4444') {
  const t = document.createElement('div');
  t.className   = 'toast-notification';
  t.textContent = msg;
  t.style.background = color;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); }, 2500);
}

function spawnConfetti() {
  const c = document.createElement('div'); c.className = 'confetti-container';
  document.body.appendChild(c);
  const colors = ['#6c63ff','#a855f7','#f5a623','#ff6b6b','#22c55e','#ff8e53','#38bdf8'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div'); p.className = 'confetti';
    p.style.left       = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--fall-duration',  (2 + Math.random() * 2) + 's');
    p.style.setProperty('--fall-delay',     (Math.random() * .8) + 's');
    const sz = (6 + Math.random() * 8) + 'px';
    p.style.width  = sz; p.style.height = sz;
    p.style.borderRadius = Math.random() > .5 ? '50%' : '2px';
    c.appendChild(p);
  }
  setTimeout(() => c.remove(), 5000);
}

// ─── UI-ONLY SCREEN RENDERERS ────────────────────────────

function _renderHome() {
  const badge = document.getElementById('daily-badge');
  if (badge) badge.textContent = Save.data.daily[new Date().toDateString()] ? '✓' : 'NEW';
  // Keep home-screen coin pill in sync with the current balance
  const homeCoins = document.getElementById('home-coins');
  if (homeCoins) homeCoins.textContent = '\uD83E\uDE99 ' + (Save.data.totalCoins || 0);
}

function _resetCreate() {
  // Reset upload zone
  const zone = document.getElementById('upload-zone');
  const placeholder = document.getElementById('upload-placeholder');
  const preview = document.getElementById('image-preview');
  const changeBtn = document.getElementById('upload-change');
  if (zone) { delete zone.dataset.image; zone.classList.remove('has-image', 'drag-over', 'shake'); }
  if (placeholder) placeholder.classList.remove('hidden');
  if (preview)    { preview.classList.add('hidden'); preview.style.backgroundImage = ''; }
  if (changeBtn)  changeBtn.classList.add('hidden');

  // Reset size picker to 3×3
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.size-btn[data-size="3"]')?.classList.add('active');
  const sizeSelect = document.getElementById('custom-size');
  if (sizeSelect) sizeSelect.value = '3';

  // Reset shape picker to square
  document.querySelectorAll('.create-shape-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.create-shape-btn[data-shape="square"]')?.classList.add('active');
  const shapeSelect = document.getElementById('custom-shape');
  if (shapeSelect) shapeSelect.value = 'square';
}

function _renderLeaderboard() {
  const container = document.getElementById('lb-container');
  if (!container || typeof DB === 'undefined' || !DB.leaderboard) return;
  
  const scores = DB.leaderboard.getTop();
  
  if (!scores.length) {
    container.innerHTML = `
      <div class="lb-empty">
        <span class="lb-empty-icon">📊</span>
        <p>No scores yet.</p>
        <p style="font-size:0.8rem; margin-top:4px;">Play some puzzles to rank up!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = scores.map((s, i) => {
    let rankDisplay = i + 1;
    if (i === 0) rankDisplay = '🥇';
    else if (i === 1) rankDisplay = '🥈';
    else if (i === 2) rankDisplay = '🥉';

    const dateStr = new Date(s.ts).toLocaleDateString();
    
    return `
      <div class="lb-item">
        <div class="lb-rank">${rankDisplay}</div>
        <div class="lb-details">
          <div class="lb-name">
            ${s.username}
            ${s.isCustom ? '<span class="lb-badge">Custom</span>' : ''}
          </div>
          <div class="lb-meta">
            <span>${s.shape}</span>
            <span>•</span>
            <span>${s.levelDisplay}</span>
          </div>
        </div>
        <div class="lb-score-col">
          <div class="lb-score">${s.score.toLocaleString()}</div>
          <div class="lb-date">${dateStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

function _renderShapeSelect() {
  SHAPES.forEach(sh => {
    const el = document.getElementById(`prog-${sh}`);
    if (el) el.textContent = `${Save.data.progress[sh] || 0} / 350`;
  });
}

let _campaignShape = 'square';

function _renderLevelMap(data) {
  if (data?.shape) _campaignShape = data.shape;
  const grid  = document.getElementById('levels-grid');
  const title = document.getElementById('levels-title');
  grid.innerHTML = '';
  if (title) title.textContent = _campaignShape.toUpperCase();

  const progressCount = Save.data.progress[_campaignShape] || 0;
  const bestStars     = Save.data.bestStars || {};

  // Build true unlock state — respecting star-gate going forward
  // but grandfathering any levels already in progress[].
  //   • level 0 is always unlocked.
  //   • level i is unlocked if:
  //       – i < progressCount (old player, grandfather as 2-star)
  //       – OR the previous level has bestStars >= 2
  //   • level i is current if it equals progressCount AND it's unlocked.
  function getStarsFor(i) {
    const key = `${_campaignShape}_${i}`;
    const saved = bestStars[key] || 0;
    // Grandfather: if this level is inside the old progress counter but has
    // no bestStars record, treat it as 2-star equivalent so it stays unlocked.
    if (saved === 0 && i < progressCount) return 2;
    return saved;
  }

  function isUnlocked(i) {
    if (i === 0) return true;
    if (i < progressCount) return true;   // grandfathered
    const prevStars = getStarsFor(i - 1);
    return prevStars >= 2;
  }

  for (let i = 0; i < TOTAL_LEVELS; i++) {
    const btn          = document.createElement('div');
    btn.className      = 'level-tile';
    const lvlData      = (typeof LEVELS !== 'undefined' && LEVELS[i]) || {};
    const milestone    = lvlData.difficulty === 'milestone';
    const unlocked     = isUnlocked(i);
    const myStars      = getStarsFor(i);
    const done         = unlocked && myStars > 0;   // completed at least once
    const current      = !done && unlocked;          // next to play
    const locked       = !unlocked;

    if (milestone) btn.classList.add('milestone');
    if (done)    btn.classList.add('done');
    if (current) btn.classList.add('current');
    if (locked)  btn.classList.add('locked');

    if (locked) {
      btn.textContent = '🔒';
    } else if (done) {
      // Show level number + compact star row
      btn.innerHTML = `<span class="tile-num">${i + 1}</span><span class="tile-stars">${'★'.repeat(myStars)}${'☆'.repeat(3 - myStars)}</span>`;
    } else {
      btn.textContent = i + 1;   // current / unlocked-not-yet-played
    }

    if (unlocked) {
      btn.addEventListener('click', () => Nav.go('screen-game', { shape: _campaignShape, level: i }));
    }
    grid.appendChild(btn);
  }
}

function _renderDaily() {
  const now = new Date(), key = now.toDateString();
  const el  = document.getElementById('daily-date-display');
  if (el) el.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    if (Save.data.daily[d.toDateString()]) streak++; else break;
  }
  const se = document.getElementById('daily-streak');
  if (se) se.textContent = `🔥 ${streak} day streak`;

  const cal = document.getElementById('daily-calendar');
  if (cal) {
    cal.innerHTML = '';
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const div = document.createElement('div');
      div.className   = `cal-day${Save.data.daily[d.toDateString()] ? ' done' : ''}`;
      div.textContent = d.getDate();
      cal.appendChild(div);
    }
  }

  const done = !!Save.data.daily[key];
  const btn  = document.getElementById('btn-daily-play');
  if (btn) { btn.textContent = done ? '✓ Completed Today' : '▶ PLAY TODAY'; btn.disabled = done; }
}

function _renderMaster() {
  const total    = Save.totalSolved(), unlocked = total >= MASTER_UNLOCK;
  const hint     = document.getElementById('master-unlock-hint');
  if (hint) hint.textContent = unlocked
    ? `${total} levels solved — Master unlocked!`
    : `Complete ${MASTER_UNLOCK} levels to unlock (${total}/${MASTER_UNLOCK})`;
  const grid = document.getElementById('master-grid');
  grid.innerHTML = '';
  const done = Save.data.masterDone || [];
  for (let i = 0; i < MASTER_LEVELS; i++) {
    const btn = document.createElement('div');
    btn.className = 'level-tile';
    if (done.includes(i))  { btn.classList.add('done');   btn.textContent = '✓'; }
    else if (!unlocked)    { btn.classList.add('locked');  btn.textContent = '🔒'; }
    else btn.textContent = 'M' + (i + 1);
    if (unlocked) btn.addEventListener('click', () => {
      let size  = Math.min(3 + Math.floor(i / 4), 9);
      const shape = SHAPES[i % SHAPES.length];
      // Triangle is capped at TRIANGLE_MAX; _validateGameConfig would auto-
      // downgrade silently — be explicit here so the correct shape is kept.
      if (shape === 'triangle') size = Math.min(size, TRIANGLE_MAX);
      Nav.go('screen-game', {
        shape, level: 0,
        customCfg: { image: `url('https://picsum.photos/id/${500 + (i * 7) % 400}/400/400')`, size, shape, isMaster: true, masterIdx: i },
      });
    });
    grid.appendChild(btn);
  }
}

// ─── LAUNCH CUSTOM PUZZLE ────────────────────────────────
function _launchCustom(publish) {
  const imageUrl = document.getElementById('upload-zone').dataset.image;
  if (!imageUrl) { showToast('Please upload an image first'); return; }
  const size  = parseInt(document.getElementById('custom-size').value) || 3;
  const shape = document.getElementById('custom-shape').value || 'square';
  const puzzle = {
    id: 'c_' + Date.now(),
    title: `Custom ${shape} ${size}×${size}`,
    creator: Save.data.username || 'Player',
    image: imageUrl, size, shape, likes: 0, ts: Date.now(),
  };
  if (publish) { Community.publish(puzzle); showToast('Published! 🌍', '#22c55e'); }
  Nav.go('screen-game', { shape, level: 0, customCfg: { image: imageUrl, size, shape } });
}

// ─── EVENT BINDING ───────────────────────────────────────
// All addEventListener calls live here and ONLY here.
// Each handler delegates to the correct module without reaching across boundaries.
function bindEvents() {
  const $ = id => document.getElementById(id);
  const on = (id, fn) => $(id)?.addEventListener('click', fn);

  // ── Onboarding ──────────────────────────────────────────
  on('ob-submit', () => {
    const val = $('ob-input').value.trim(), err = $('ob-error');
    if (val.length < 3) { err.textContent = 'Must be at least 3 characters'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    Save.data.username = val; Save.flush();
    DB.users.ensureCurrentUser();
    Nav.go('screen-home');
  });
  $('ob-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('ob-submit').click(); });

  // ── Home ────────────────────────────────────────────────
  on('btn-play', () => {
    const shape = _campaignShape || 'square';
    const done  = Save.data.progress[shape] || 0;
    // Clamp to last valid level so we never pass level >= TOTAL_LEVELS
    const level = Math.min(done, TOTAL_LEVELS - 1);
    Nav.go('screen-game', { shape, level });
  });
  on('btn-daily-home',    () => Nav.go('screen-daily'));
  on('btn-master-home',   () => Nav.go('screen-master'));
  on('btn-explore-home',  () => Nav.go('screen-explore'));
  on('btn-leaderboard-card', () => Nav.go('screen-leaderboard'));
  on('btn-create-home',   () => Nav.go('screen-create'));
  on('btn-home-profile',  () => Nav.go('screen-profile'));
  on('btn-collection',    () => Nav.go('screen-shape-select'));
  on('btn-settings-home', () => openModal('modal-settings'));

  // ── Generic back buttons ────────────────────────────────
  document.querySelectorAll('.back-btn').forEach(b => b.addEventListener('click', () => Nav.back()));

  // ── Shape select ────────────────────────────────────────
  document.querySelectorAll('.shape-tile').forEach(t => t.addEventListener('click', () => {
    _campaignShape = t.dataset.shape;
    document.querySelectorAll('.shape-tile').forEach(x => x.classList.remove('selected'));
    t.classList.add('selected');
    Nav.go('screen-levels', { shape: _campaignShape });
  }));

  // ── Levels & Game ───────────────────────────────────────
  on('levels-back', () => Nav.back());
  on('game-back', () => {
    if (G.pieces?.length && !G.isWon) openModal('modal-confirm-exit');
    else { Timer.pause(); Nav.back(); }
  });
  on('btn-confirm-exit', () => { closeModal('modal-confirm-exit'); Timer.pause(); Nav.back(); });
  on('btn-cancel-exit',  () => closeModal('modal-confirm-exit'));

  // ── Game controls ───────────────────────────────────────
  on('btn-reset', () => startGame({
    shape: G.levelShape || G.shape, level: G.level,
    customCfg: G.isCustom ? { image: G.image, size: G.cols, shape: G.shape } : null,
  }));
  on('btn-hint', () => {
    const wrong  = G.pieces.find(p => p.currentSlot !== p.homeSlot);
    if (!wrong) { showToast('All pieces are correct!', '#22c55e'); return; }
    const target = G.pieces.find(p => p.homeSlot === wrong.currentSlot && p.currentSlot !== p.homeSlot) || wrong;
    if (target.wrap) { target.wrap.classList.add('hint-highlight'); setTimeout(() => target.wrap.classList.remove('hint-highlight'), 3200); }
    showToast('💡 This piece is misplaced!', '#6c63ff');
  });
  on('game-settings-btn', () => openModal('modal-settings'));

  // ── Victory ─────────────────────────────────────────────
  on('btn-next-level', () => {
    if (typeof _cancelAutoAdvance === 'function') _cancelAutoAdvance();
    // Reset button state in case it was disabled by 1-star gate
    const nb = document.getElementById('btn-next-level');
    if (nb) { nb.disabled = false; nb.style.opacity = '1'; nb.style.cursor = 'pointer'; }
    closeModal('modal-victory');
    const shape = G.levelShape || G.shape;
    const next = (G.level || 0) + 1;
    if (next < TOTAL_LEVELS) {
      if (Nav.stack.length > 0) Nav.stack[Nav.stack.length - 1].data = { shape, level: next };
      startGame({ shape, level: next });
    }
    else { showToast('🎉 All levels complete!', '#22c55e'); Nav.back(); }
  });
  on('btn-replay',  () => { if (typeof _cancelAutoAdvance === 'function') _cancelAutoAdvance(); closeModal('modal-victory'); startGame({ shape: G.levelShape || G.shape, level: G.level, customCfg: G.isCustom ? { image: G.image, size: G.cols, shape: G.shape } : null }); });
  on('btn-to-menu', () => { if (typeof _cancelAutoAdvance === 'function') _cancelAutoAdvance(); closeModal('modal-victory'); Nav.go('screen-home'); });

  // ── Settings ────────────────────────────────────────────
  on('btn-close-settings', () => closeModal('modal-settings'));
  $('toggle-sound')?.addEventListener('change', e => { Save.data.settings.sound  = e.target.checked; Save.flush(); });
  $('toggle-haptic')?.addEventListener('change', e => { Save.data.settings.haptic = e.target.checked; Save.flush(); });

  // ── Profile ─────────────────────────────────────────────
  on('btn-edit-username', () => {
    const n = prompt('New username (3–15 chars):');
    if (n?.trim().length >= 3) {
      Save.data.username = n.trim().slice(0, 15); Save.flush();
      DB.users.ensureCurrentUser();  // update DB record
      renderProfile();
    }
  });

  // ── Community feed tabs ─────────────────────────────────
  document.querySelectorAll('.feed-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active'); renderCommunity();
  }));

  // ── Create puzzle ───────────────────────────────────────
  const uploadZone  = $('upload-zone');
  const uploadInput = $('image-upload');

  // Helper: show the loaded image in the upload zone
  function _setCreateImage(dataUrl) {
    const preview = $('image-preview');
    const placeholder = $('upload-placeholder');
    const changeBtn  = $('upload-change');
    if (!preview) return;
    preview.style.backgroundImage = `url('${dataUrl}')`;
    preview.classList.remove('hidden');
    placeholder?.classList.add('hidden');
    changeBtn?.classList.remove('hidden');
    uploadZone.dataset.image = `url('${dataUrl}')`;
    uploadZone.classList.add('has-image');
  }

  // Helper: read a File object and load it as a resized data URL
  function _readImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select an image file (JPG, PNG, GIF…)', '#ef4444'); return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      // Resize to max 1200px to keep memory sane
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        _setCreateImage(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => showToast('Could not load that image', '#ef4444');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Click / keyboard on upload zone
  uploadZone?.addEventListener('click', e => {
    if (e.target.id === 'upload-change' || e.target.closest('#upload-change')) return; // handled separately
    uploadInput?.click();
  });
  uploadZone?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); uploadInput?.click(); }
  });

  // "Change image" overlay click
  $('upload-change')?.addEventListener('click', e => {
    e.stopPropagation(); uploadInput?.click();
  });

  // File input change
  uploadInput?.addEventListener('change', e => {
    _readImageFile(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-selected
  });

  // Drag-and-drop
  uploadZone?.addEventListener('dragenter', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone?.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone?.addEventListener('dragleave', e => { if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over'); });
  uploadZone?.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    _readImageFile(e.dataTransfer.files[0]);
  });

  // Visual size picker
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sel = $('custom-size');
      if (sel) sel.value = btn.dataset.size;
    });
  });

  // Visual shape picker
  document.querySelectorAll('.create-shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.create-shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sel = $('custom-shape');
      if (sel) sel.value = btn.dataset.shape;
    });
  });

  // Play / Publish with image guard
  function _guardedLaunch(publish) {
    if (!uploadZone?.dataset.image) {
      showToast('📷 Upload an image first!', '#ef4444');
      uploadZone?.classList.add('shake');
      setTimeout(() => uploadZone?.classList.remove('shake'), 500);
      return;
    }
    _launchCustom(publish);
  }
  on('btn-create-play',    () => _guardedLaunch(false));
  on('btn-create-publish', () => _guardedLaunch(true));

  // ── Daily puzzle ────────────────────────────────────────
  on('btn-daily-play', () => {
    Save.data.daily[new Date().toDateString()] = true; Save.flush();
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const dailyId   = (dayOfYear * 13 + 17) % 900 + 50;
    Nav.go('screen-game', { shape: 'square', level: 0, customCfg: { image: `url('https://picsum.photos/id/${dailyId}/400/400')`, size: 4, shape: 'square', isDaily: true } });
    _renderDaily();
  });

  // ── Chat ────────────────────────────────────────────────
  on('chat-back',  () => Nav.back());
  on('chat-send',  sendChatMessage);
  $('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

  // ── Visibility (pause timer when tab hidden) ─────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Timer.pause();
    else if (Nav.current() === 'screen-game' && !G.isWon) Timer.start();
  });
}

// ─── BOOT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. Load persistent data
  Save.load();
  Audio.init();

  // 2. Boot social DB (seeds demo users + messages on first run)
  DB.users.seed();
  const myUid = DB.users.ensureCurrentUser();  // single call — used by seedDemoMessages below
  if (!DB._get('mosaic_msg_seeded')) {
    DB.messages.seedDemoMessages(myUid);
    DB._set('mosaic_msg_seeded', true);
  }

  // 3. Bind all UI events
  bindEvents();

  // 4. Apply saved settings to toggles
  document.getElementById('toggle-sound').checked  = Save.data.settings.sound;
  document.getElementById('toggle-haptic').checked = Save.data.settings.haptic;

  // 5. Navigate to first screen
  Nav.go(Save.data.username ? 'screen-home' : 'screen-onboarding');

  // 6. Music FAB
  const musicBtn = document.createElement('button');
  musicBtn.className   = 'music-toggle';
  musicBtn.textContent = '🎵';
  musicBtn.setAttribute('aria-label', 'Toggle background music');
  musicBtn.addEventListener('click', () => {
    const p = Audio.toggleBGM();
    musicBtn.classList.toggle('playing', p);
    musicBtn.textContent        = p ? '🔊' : '🎵';
    Save.data.settings.bgm = p; Save.flush();
  });
  document.body.appendChild(musicBtn);

  if (Save.data.settings.bgm) {
    document.addEventListener('pointerdown', function go() {
      Audio.startBGM(); musicBtn.classList.add('playing'); musicBtn.textContent = '🔊';
      document.removeEventListener('pointerdown', go);
    }, { once: true });
  }

  // 7. PWA install banner
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `<span class="install-banner-text">✨ Install Mosaic for the best experience!</span>
      <div class="install-banner-actions">
        <button class="btn btn-primary btn-sm" id="btn-install">Install</button>
        <button class="btn btn-ghost btn-sm"   id="btn-dismiss-install">✕</button>
      </div>`;
    document.body.appendChild(banner);
    document.getElementById('btn-install')?.addEventListener('click',         () => { e.prompt(); banner.remove(); });
    document.getElementById('btn-dismiss-install')?.addEventListener('click', () => banner.remove());
  });
});
