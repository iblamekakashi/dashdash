'use strict';
/* ═══════════════════════════════════════════════════════════
   MOSAIC — db.js
   Social data layer: Users · Follows · Messages
   Firebase-ready — swap localStorage for Firebase SDK calls.
   Depends on: config.js (Save)
   ═══════════════════════════════════════════════════════════ */

// ─── COMMUNITY (puzzle feed) ─────────────────────────────
const Community = {
  _get(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  getPublic() { return this._get('mosaic_community'); },
  getUser()   { return this._get('mosaic_user_puzzles'); },

  publish(p) {
    const pub = this.getPublic(), usr = this.getUser();
    pub.unshift(p); usr.unshift(p);
    this._set('mosaic_community', pub);
    this._set('mosaic_user_puzzles', usr);
  },

  toggleLike(id) {
    const liked = Save.data.likedPuzzles, idx = liked.indexOf(id);
    idx === -1 ? liked.push(id) : liked.splice(idx, 1);
    Save.flush();
    const pub = this.getPublic(), p = pub.find(x => x.id === id);
    if (p) { p.likes = (p.likes || 0) + (idx === -1 ? 1 : -1); this._set('mosaic_community', pub); }
    return idx === -1;
  },

  isLiked(id) { return Save.data.likedPuzzles.includes(id); },

  seed() {
    if (this.getPublic().length) return;
    this._set('mosaic_community', [
      { id: 'demo1', creator: 'ArtBot',    image: "url('https://picsum.photos/id/15/300/300')", size: 3, shape: 'square',   likes: 14, title: 'Sunrise'    },
      { id: 'demo2', creator: 'PuzzlePro', image: "url('https://picsum.photos/id/29/300/300')", size: 4, shape: 'jigsaw',   likes: 8,  title: 'Ocean View' },
      { id: 'demo3', creator: 'ArtBot',    image: "url('https://picsum.photos/id/43/300/300')", size: 3, shape: 'triangle', likes: 22, title: 'Mountain'   },
      { id: 'demo4', creator: 'Mosaic',    image: "url('https://picsum.photos/id/57/300/300')", size: 4, shape: 'square',   likes: 5,  title: 'Forest'     },
    ]);
  },
};

// ─── DB — Firebase-ready flat-collection model ───────────
const DB = {
  _get(k) { try { return JSON.parse(localStorage.getItem(k)) ?? null; } catch { return null; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },

  // ── users/{uid} ─────────────────────────────────────────
  users: {
    DEMO: [
      { uid: 'u_artbot',     username: 'ArtBot',     avatar: '🤖', createdAt: Date.now() - 864e5 * 30 },
      { uid: 'u_puzzlepro',  username: 'PuzzlePro',  avatar: '🧩', createdAt: Date.now() - 864e5 * 20 },
      { uid: 'u_mosaic',     username: 'Mosaic',     avatar: '🔷', createdAt: Date.now() - 864e5 * 15 },
      { uid: 'u_pixelqueen', username: 'PixelQueen', avatar: '👑', createdAt: Date.now() - 864e5 * 10 },
      { uid: 'u_stormzen',   username: 'StormZen',   avatar: '⚡', createdAt: Date.now() - 864e5 * 5  },
      { uid: 'u_novaglyph',  username: 'NovaGlyph',  avatar: '🌌', createdAt: Date.now() - 864e5 * 2  },
    ],
    _store() { return DB._get('mosaic_users') || {}; },
    _save(u) { DB._set('mosaic_users', u); },

    seed() {
      const users = this._store();
      this.DEMO.forEach(u => { if (!users[u.uid]) users[u.uid] = u; });
      this._save(users);
    },
    create(username) {
      const uid = 'u_' + username.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now().toString(36);
      const user = { uid, username, avatar: '🧑', createdAt: Date.now() };
      const users = this._store(); users[uid] = user; this._save(users);
      return user;
    },
    getAll()  { return Object.values(this._store()); },
    get(uid)  { return this._store()[uid] || null; },
    findByName(name) {
      return Object.values(this._store())
        .find(u => u.username.toLowerCase() === name.toLowerCase()) || null;
    },
    ensureCurrentUser() {
      const name = Save.data.username || 'Player';
      let user = this.findByName(name);
      if (!user) user = this.create(name);
      return user.uid;
    },
  },

  // ── follows/{followerUid}_{followingUid} ─────────────────
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
    followersOf(uid)  { return Object.values(this._store()).filter(r => r.followingUid === uid).length; },
    followingOf(uid)  { return Object.values(this._store()).filter(r => r.followerUid  === uid).length; },
    followingUids(uid){ return Object.values(this._store()).filter(r => r.followerUid  === uid).map(r => r.followingUid); },
    followingNames(uid) {
      const users = DB.users._store();
      return this.followingUids(uid).map(id => users[id]?.username).filter(Boolean);
    },
  },

  // ── messages/{chatId}/{msgId} ────────────────────────────
  // chatId = [uid1, uid2].sort().join('_')  ← symmetric
  messages: {
    _store() { return DB._get('mosaic_messages') || {}; },
    _save(m) { DB._set('mosaic_messages', m); },
    chatId: (a, b) => [a, b].sort().join('_'),

    send(senderUid, receiverUid, text) {
      const m = this._store();
      const cid = this.chatId(senderUid, receiverUid);
      if (!m[cid]) m[cid] = [];
      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        senderUid, receiverUid, text: text.trim(), ts: Date.now(),
      };
      m[cid].push(msg); this._save(m); return msg;
    },

    getChat(uid1, uid2) {
      const m = this._store()[this.chatId(uid1, uid2)] || [];
      return [...m].sort((a, b) => a.ts - b.ts);
    },

    getConversations(uid) {
      const m = this._store(), convos = [];
      Object.entries(m).forEach(([cid, msgs]) => {
        if (!cid.includes(uid) || !msgs.length) return;
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
        ['u_artbot',     'Hey! Love your puzzles! 🎨'],
        ['u_puzzlepro',  'Can we do a puzzle collab? 🧩'],
        ['u_pixelqueen', 'Your solve time is insane! ⚡'],
      ];
      pairs.forEach(([peerUid, text]) => {
        const cid = this.chatId(currentUid, peerUid);
        if (!m[cid]) {
          m[cid] = [{
            id: peerUid + '_seed',
            senderUid: peerUid, receiverUid: currentUid,
            text, ts: Date.now() - Math.random() * 864e5,
          }];
        }
      });
      this._save(m);
    },
  },

  // ── leaderboard ──────────────────────────────────────────
  leaderboard: {
    _store() { return DB._get('mosaic_leaderboard') || []; },
    _save(lb) { DB._set('mosaic_leaderboard', lb); },

    saveScore(username, score, shape, levelDisplay, isCustom) {
      const lb = this._store();
      // Keep only highest score per player per level
      const existingIdx = lb.findIndex(x => x.username === username && x.shape === shape && x.levelDisplay === levelDisplay && x.isCustom === isCustom);
      
      const entry = { username, score, shape, levelDisplay, isCustom, ts: Date.now() };

      if (existingIdx !== -1) {
        if (score <= lb[existingIdx].score) return;
        lb[existingIdx] = entry;
      } else {
        lb.push(entry);
      }

      lb.sort((a, b) => b.score - a.score); // descending
      if (lb.length > 50) lb.length = 50;
      this._save(lb);
    },

    getTop() { return this._store(); }
  },
};
