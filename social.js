'use strict';
/* ═══════════════════════════════════════════════════════════
   MOSAIC — social.js
   Social system renderers: followers · chat · inbox.
   NO game engine logic, NO navigation stack.
   Depends on: config.js (Save, Audio) · db.js (DB, Community)
   Calls Nav (defined in ui.js) for screen transitions.
   ═══════════════════════════════════════════════════════════ */

/** Relative-time formatter for message timestamps. */
function fmtMsgTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── PROFILE (own) ───────────────────────────────────────
function renderProfile() {
  const myUid = DB.users.ensureCurrentUser();
  const u = Save.data.username || 'Player';
  const lk = Community.getPublic()
    .filter(p => p.creator === u)
    .reduce((s, p) => s + (p.likes || 0), 0);

  document.getElementById('profile-username').textContent = u;
  document.getElementById('profile-total').textContent = `${Save.totalSolved()} puzzles solved`;
  document.getElementById('stat-followers').textContent = DB.follows.followersOf(myUid);
  document.getElementById('stat-following').textContent = DB.follows.followingOf(myUid);
  document.getElementById('stat-likes').textContent = lk;
  document.getElementById('stat-created').textContent = Community.getUser().length;

  SHAPES.forEach(sh => {
    const el = document.getElementById(`prof-${sh}`);
    if (el) el.textContent = `${Save.data.progress[sh] || 0}/350`;
  });

  const gallery = document.getElementById('profile-gallery');
  gallery.innerHTML = '';
  Community.getUser()
    .filter(p => p.creator === u)
    .forEach(p => gallery.appendChild(buildGalleryCard(p)));
  if (!gallery.children.length)
    gallery.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:20px 0">No uploads yet.</p>';
}

// ─── PUBLIC PROFILE ──────────────────────────────────────
function renderPublicProfile(username) {
  const myUid = DB.users.ensureCurrentUser();
  const peer = DB.users.findByName(username);
  const peerUid = peer?.uid || null;

  document.getElementById('pub-username').textContent = username || 'Player';
  document.getElementById('pub-avatar').textContent = peer?.avatar || '👤';
  if (peerUid) document.getElementById('pub-uid').textContent = peerUid;

  document.getElementById('pub-stat-followers').textContent =
    peerUid ? DB.follows.followersOf(peerUid) : '—';
  document.getElementById('pub-stat-following').textContent =
    peerUid ? DB.follows.followingOf(peerUid) : '—';

  const followBtn = document.getElementById('btn-follow');
  const isMe = username === (Save.data.username || 'Player');
  if (isMe) {
    followBtn.textContent = "That's You!";
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
    };
  }

  const msgBtn = document.getElementById('btn-message-user');
  msgBtn.onclick = () => {
    if (!peerUid) { showToast('User not found'); return; }
    Nav.go('screen-chat', { peerUid });
  };

  const gallery = document.getElementById('pub-gallery');
  gallery.innerHTML = '';
  Community.getPublic()
    .filter(p => p.creator === username)
    .forEach(p => gallery.appendChild(buildGalleryCard(p)));
  if (!gallery.children.length)
    gallery.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:20px 0">No uploads yet.</p>';
}

function buildGalleryCard(puzzle) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const liked = Community.isLiked(puzzle.id);

  // Structure only — no user data in innerHTML to prevent XSS
  card.innerHTML = `
    <div class="gallery-thumb" style="background-image:${puzzle.image}"></div>
    <div class="gallery-info">
      <h4 class="card-title"></h4>
      <p><span class="creator-link" data-creator=""></span><span class="card-meta"></span></p>
      <div class="gallery-likes">
        <button class="like-btn ${liked ? 'liked' : ''}" data-id="${puzzle.id}">♥</button>
        <span class="like-count" id="lc-${puzzle.id}">${puzzle.likes || 0}</span>
      </div>
    </div>`;

  // User-supplied strings set via textContent (safe from XSS)
  card.querySelector('.card-title').textContent = puzzle.title || puzzle.shape || 'Puzzle';
  const creatorEl = card.querySelector('.creator-link');
  creatorEl.textContent = puzzle.creator || 'Unknown';
  creatorEl.dataset.creator = puzzle.creator || '';
  card.querySelector('.card-meta').textContent = ` · ${puzzle.shape} ${puzzle.size}×${puzzle.size}`;

  // Creator name → public profile (stops propagation to avoid launching puzzle)
  creatorEl.addEventListener('click', ev => {
    ev.stopPropagation();
    Nav.go('screen-public-profile', { username: puzzle.creator });
  });

  card.querySelector('.like-btn').addEventListener('click', ev => {
    ev.stopPropagation();
    const now = Community.toggleLike(puzzle.id);
    ev.target.classList.toggle('liked', now);
    const lc = document.getElementById(`lc-${puzzle.id}`);
    if (lc) lc.textContent = (parseInt(lc.textContent) || 0) + (now ? 1 : -1);
  });

  // Card body → launch puzzle
  card.addEventListener('click', () => Nav.go('screen-game', {
    shape: puzzle.shape, level: 0,
    customCfg: { image: puzzle.image, size: puzzle.size, shape: puzzle.shape },
  }));
  return card;
}

// ─── COMMUNITY FEED ──────────────────────────────────────
function renderCommunity() {
  Community.seed();
  const myUid = DB.users.ensureCurrentUser();
  const followedNames = DB.follows.followingNames(myUid);
  const feed = document.getElementById('community-feed');
  const tab = document.querySelector('.feed-tab.active');
  const mode = tab?.dataset.tab || 'all';
  feed.innerHTML = '';

  let items = Community.getPublic();
  if (mode === 'following') {
    items = items.filter(p => followedNames.includes(p.creator));
  } else {
    const pri = items.filter(p => followedNames.includes(p.creator));
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
function renderMessages() {
  const myUid = DB.users.ensureCurrentUser();
  const list = document.getElementById('messages-list');
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

    // Build structure with createElement to avoid XSS from username / message text
    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-preview-avatar';
    avatarEl.textContent = peer.avatar || '\u{1F464}';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-preview-body';

    const nameEl = document.createElement('div');
    nameEl.className = 'msg-preview-name';
    nameEl.textContent = peer.username;

    const textEl = document.createElement('div');
    textEl.className = 'msg-preview-text';
    textEl.textContent = (isMine ? 'You: ' : '') + latest.text;

    const timeEl = document.createElement('div');
    timeEl.className = 'msg-preview-time';
    timeEl.textContent = fmtMsgTime(latest.ts);

    bodyEl.appendChild(nameEl);
    bodyEl.appendChild(textEl);
    item.appendChild(avatarEl);
    item.appendChild(bodyEl);
    item.appendChild(timeEl);

    item.addEventListener('click', () => Nav.go('screen-chat', { peerUid }));
    list.appendChild(item);
  });
}

// ─── CHAT (1-to-1) ───────────────────────────────────────
let _chatPeerUid = null;  // tracks the active chat partner

function renderChat(peerUid) {
  _chatPeerUid = peerUid;
  const myUid = DB.users.ensureCurrentUser();
  const peer = DB.users.get(peerUid);

  document.getElementById('chat-peer-avatar').textContent = peer?.avatar || '👤';
  document.getElementById('chat-peer-name').textContent = peer?.username || 'User';

  _renderChatMessages(myUid, peerUid);
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
      label.textContent = new Date(msg.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      container.appendChild(label);
    }
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.senderUid === myUid ? 'mine' : 'theirs'}`;

    // Use textContent for user-supplied message text to prevent XSS
    const msgText = document.createTextNode(msg.text);
    const timeEl = document.createElement('div');
    timeEl.className = 'chat-bubble-time';
    timeEl.textContent = fmtMsgTime(msg.ts);
    bubble.appendChild(msgText);
    bubble.appendChild(timeEl);

    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text || !_chatPeerUid) return;
  const myUid = DB.users.ensureCurrentUser();
  DB.messages.send(myUid, _chatPeerUid, text);
  input.value = '';
  _renderChatMessages(myUid, _chatPeerUid);
  Audio.play('drag');
}
