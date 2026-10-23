"use strict";

/* The Sesh Room — public version
   Feed posts, comments and room messages live in Supabase (public
   read + add, append-only). Identity is a friendly display name kept
   on this device — same spirit as the private prototype. Live video
   seshes run phone-to-phone (WebRTC) with Supabase Realtime signaling.
   Site values come from config.js -> window.SESH_CONFIG.
*/

const ROOMS = [
  { id: "lounge",     name: "The Lounge",       emoji: "🛋️", desc: "Main hangout — pull up, say hey, pass the vibe.", topic: "General sesh",  mode: "All",   color: "#1E4D2E", live: true },
  { id: "wake-bake",  name: "Wake & Bake",      emoji: "☀️", desc: "Morning crew. Coffee, first bowl, plans for the day.", topic: "Morning sesh", mode: "All", color: "#B7791F", live: true },
  { id: "grow-talk",  name: "Grow Talk",        emoji: "🌱", desc: "Lights, soil, tents, harvest help — growers helping growers.", topic: "Growing", mode: "Text", color: "#2F6B3A" },
  { id: "strain-swap", name: "Strain Swap",     emoji: "💨", desc: "What are you smoking? Reviews, favorites, and finds.", topic: "Strains", mode: "All", color: "#4A6741" },
  { id: "late-night", name: "Late Night Sesh",  emoji: "🌙", desc: "After midnight. Chill music, deep talks, slow vibes.", topic: "Late night", mode: "Voice", color: "#2C3E2D", live: true },
  { id: "munchies",   name: "Munchies & Music", emoji: "🍕", desc: "Snack rankings, playlists, and what you're listening to.", topic: "Food + music", mode: "Text", color: "#8A5A2B" }
];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function initials(n) { return (String(n || "").trim().slice(0, 2) || "??").toUpperCase(); }

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Supabase ---------- */
const cfg = window.SESH_CONFIG || {};
const sbReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
let sb = null;
if (sbReady) sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

/* ---------- identity: a display name on this device ---------- */
let displayName = localStorage.getItem("sesh_name") || "";
function refreshNameChip() {
  $("nameChip").textContent = displayName ? displayName : "Set your name";
}
function requireName() {
  if (displayName) return true;
  openNameModal();
  toast("Pick a display name first");
  return false;
}
function openNameModal() {
  $("nameInput").value = displayName || "";
  $("nameOverlay").hidden = false;
  setTimeout(() => $("nameInput").focus(), 60);
}
$("nameChip").addEventListener("click", openNameModal);
$("nameCancelBtn").addEventListener("click", () => { $("nameOverlay").hidden = true; });
$("nameSaveBtn").addEventListener("click", () => {
  const v = $("nameInput").value.trim().slice(0, 24);
  if (!v) { toast("Type any friendly name"); return; }
  displayName = v;
  localStorage.setItem("sesh_name", v);
  $("nameOverlay").hidden = true;
  refreshNameChip();
  toast("Welcome to the sesh, " + v + "!");
  renderFeed(); renderMessages();
});

/* ---------- age gate ---------- */
if (localStorage.getItem("sesh_age_ok") === "1") {
  $("ageGate").hidden = true;
} else {
  $("ageGate").hidden = false;
}
$("ageYesBtn").addEventListener("click", () => {
  localStorage.setItem("sesh_age_ok", "1");
  $("ageGate").hidden = true;
});

/* ---------- tabs ---------- */
let activeRoom = null;
let roomPoll = null;
function setTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.getAttribute("data-tab") === name));
  $("tabFeed").hidden = name !== "feed";
  $("tabRooms").hidden = name !== "rooms";
  $("tabLive").hidden = name !== "live";
  $("tabAbout").hidden = name !== "about";
  if (name !== "rooms") stopRoomPoll();
  if (name !== "live" && liveRoom) {
    teardownLive();
    $("liveView").hidden = true;
    $("liveListView").hidden = false;
  }
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab-btn").forEach((b) =>
  b.addEventListener("click", () => setTab(b.getAttribute("data-tab"))));

/* ---------- feed ---------- */
let posts = [];
const commentsCache = new Map();   // post_id -> [comments]
const openComments = new Set();    // post_ids with comments expanded
let likedSet = new Set(JSON.parse(localStorage.getItem("sesh_liked") || "[]"));

async function loadFeed() {
  if (!sbReady) { $("feedMsg").textContent = "The sesh is still setting up — check back in a minute."; return; }
  const { data, error } = await sb
    .from("sesh_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { $("feedMsg").textContent = "Couldn't load the feed — check your signal and reopen the app."; $("feedMsg").className = "inline-msg error"; return; }
  posts = data || [];
  renderFeed();
  loadStats();
}

function renderFeed() {
  $("feedEmpty").hidden = posts.length > 0;
  $("feed").innerHTML = posts.map((p) => {
    const liked = likedSet.has(p.id);
    const comments = commentsCache.get(p.id) || [];
    const showC = openComments.has(p.id);
    return `
    <article class="post" data-post="${p.id}">
      <div class="post-head">
        <span class="avatar">${esc(initials(p.author_name))}</span>
        <span class="post-who">
          <span class="post-name">${esc(p.author_name)}</span><br>
          <span class="post-time">${timeAgo(p.created_at)}</span>
        </span>
        <span class="tag-chip">${esc(p.tag)}</span>
      </div>
      <p class="post-content">${esc(p.content)}</p>
      <div class="post-actions">
        <button class="action-btn ${liked ? "liked" : ""}" type="button" data-like="${p.id}">❤️ ${p.likes || 0}</button>
        <button class="action-btn" type="button" data-comments="${p.id}">💬 Comments</button>
      </div>
      ${showC ? `
      <div class="comments">
        ${comments.map((c) => `
          <div class="comment">
            <span class="avatar">${esc(initials(c.author_name))}</span>
            <span class="comment-body">
              <span class="comment-name">${esc(c.author_name)}</span>
              <span class="comment-text"> ${esc(c.content)}</span>
            </span>
          </div>`).join("")}
        <div class="comment-compose">
          <input type="text" maxlength="300" placeholder="Add a comment…" data-comment-input="${p.id}">
          <button class="post-btn" type="button" data-comment-send="${p.id}">Post</button>
        </div>
      </div>` : ""}
    </article>`;
  }).join("");

  $("feed").querySelectorAll("[data-like]").forEach((btn) =>
    btn.addEventListener("click", () => likePost(btn.getAttribute("data-like"))));
  $("feed").querySelectorAll("[data-comments]").forEach((btn) =>
    btn.addEventListener("click", () => toggleComments(btn.getAttribute("data-comments"))));
  $("feed").querySelectorAll("[data-comment-send]").forEach((btn) =>
    btn.addEventListener("click", () => sendComment(btn.getAttribute("data-comment-send"))));
  $("feed").querySelectorAll("[data-comment-input]").forEach((inp) =>
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") sendComment(inp.getAttribute("data-comment-input")); }));
}

async function likePost(id) {
  if (!sbReady || likedSet.has(id)) return;
  likedSet.add(id);
  localStorage.setItem("sesh_liked", JSON.stringify([...likedSet]));
  const p = posts.find((x) => x.id === id);
  if (p) { p.likes = (p.likes || 0) + 1; renderFeed(); }
  const { data, error } = await sb.rpc("increment_sesh_likes", { p_id: id });
  if (!error && p && typeof data === "number") { p.likes = data; renderFeed(); }
}

async function toggleComments(id) {
  if (openComments.has(id)) { openComments.delete(id); renderFeed(); return; }
  openComments.add(id);
  if (!commentsCache.has(id)) {
    const { data } = await sb.from("sesh_comments").select("*")
      .eq("post_id", id).order("created_at", { ascending: true }).limit(100);
    commentsCache.set(id, data || []);
  }
  renderFeed();
  const inp = document.querySelector(`[data-comment-input="${id}"]`);
  if (inp) inp.focus();
}

async function sendComment(postId) {
  if (!requireName()) return;
  const inp = document.querySelector(`[data-comment-input="${postId}"]`);
  const content = (inp.value || "").trim();
  if (!content) return;
  const { data, error } = await sb.from("sesh_comments")
    .insert({ post_id: postId, author_name: displayName, content }).select().single();
  if (error) { toast("Comment didn't post — try again."); return; }
  const list = commentsCache.get(postId) || [];
  list.push(data);
  commentsCache.set(postId, list);
  renderFeed();
}

$("postBtn").addEventListener("click", async () => {
  if (!requireName()) return;
  const content = $("postText").value.trim();
  if (!content) { $("feedMsg").textContent = "Write a little something first."; return; }
  $("postBtn").disabled = true;
  const { data, error } = await sb.from("sesh_posts")
    .insert({ author_name: displayName, content, tag: $("postTag").value }).select().single();
  $("postBtn").disabled = false;
  if (error) {
    $("feedMsg").textContent = "That post didn't go through — check your signal and try again.";
    $("feedMsg").className = "inline-msg error";
    return;
  }
  $("feedMsg").textContent = "";
  $("feedMsg").className = "inline-msg";
  $("postText").value = "";
  posts.unshift(data);
  renderFeed();
  toast("Posted!");
  loadStats();
});

async function loadStats() {
  try {
    const p = await sb.from("sesh_posts").select("id", { count: "exact", head: true });
    if (typeof p.count === "number") $("statPosts").textContent = p.count;
    const m = await sb.from("sesh_messages").select("id", { count: "exact", head: true });
    if (typeof m.count === "number") $("statMsgs").textContent = m.count;
  } catch (e) { /* stats are decoration; ignore failures */ }
}

/* ---------- rooms ---------- */
function roomCard(r, count) {
  return `
    <button class="room-card" type="button" data-room="${r.id}" style="background:${r.color}">
      <span class="room-emoji">${r.emoji}</span>
      <span class="room-name">${esc(r.name)} ${r.live ? '<span class="live-badge">LIVE</span>' : ""}</span>
      <span class="room-desc">${esc(r.desc)}</span>
      <span class="room-count">${count == null ? "" : count + (count === 1 ? " message" : " messages")}</span>
    </button>`;
}
function renderRoomGrid(counts) {
  $("roomGrid").innerHTML = ROOMS.map((r) => roomCard(r, counts ? counts[r.id] : null)).join("");
  $("roomGrid").querySelectorAll("[data-room]").forEach((el) =>
    el.addEventListener("click", () => openRoom(el.getAttribute("data-room"))));
}
async function loadRoomCounts() {
  renderRoomGrid(null);
  if (!sbReady) return;
  const { data } = await sb.from("sesh_messages").select("room_id").limit(2000);
  if (!data) return;
  const counts = {};
  data.forEach((m) => { counts[m.room_id] = (counts[m.room_id] || 0) + 1; });
  renderRoomGrid(counts);
}

let messages = [];
async function openRoom(id) {
  activeRoom = ROOMS.find((r) => r.id === id) || ROOMS[0];
  $("roomListView").hidden = true;
  $("roomView").hidden = false;
  $("roomHead").style.background = activeRoom.color;
  $("roomTitle").textContent = activeRoom.emoji + " " + activeRoom.name;
  $("roomDesc").textContent = activeRoom.desc;
  window.scrollTo({ top: 0 });
  await loadMessages();
  stopRoomPoll();
  roomPoll = setInterval(loadMessages, 4000);
}
function stopRoomPoll() { if (roomPoll) { clearInterval(roomPoll); roomPoll = null; } }
$("backRoomsBtn").addEventListener("click", () => {
  stopRoomPoll();
  activeRoom = null;
  $("roomView").hidden = true;
  $("roomListView").hidden = false;
  loadRoomCounts();
});

async function loadMessages() {
  if (!activeRoom || !sbReady) return;
  const { data, error } = await sb.from("sesh_messages").select("*")
    .eq("room_id", activeRoom.id).order("created_at", { ascending: true }).limit(100);
  if (error) return; // polling: stay quiet, try again next tick
  messages = data || [];
  renderMessages(true);
}
function renderMessages(keepScroll) {
  const list = $("msgList");
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 240;
  $("msgEmpty").hidden = messages.length > 0;
  list.innerHTML = messages.map((m) => `
    <div class="msg ${displayName && m.author_name === displayName ? "mine" : ""}">
      <span class="avatar">${esc(initials(m.author_name))}</span>
      <span class="msg-body">
        <span class="msg-name">${esc(m.author_name)}<span class="msg-time">${timeAgo(m.created_at)}</span></span><br>
        <span class="msg-text">${esc(m.content)}</span>
      </span>
    </div>`).join("");
  if (keepScroll && wasNearBottom) window.scrollTo({ top: document.body.scrollHeight });
}

async function sendMessage() {
  if (!requireName() || !activeRoom) return;
  const content = $("msgInput").value.trim();
  if (!content) return;
  $("msgInput").value = "";
  const { error } = await sb.from("sesh_messages")
    .insert({ room_id: activeRoom.id, author_name: displayName, content });
  if (error) { $("msgMsg").textContent = "Message didn't send — check your signal."; $("msgMsg").className = "inline-msg error"; return; }
  $("msgMsg").textContent = ""; $("msgMsg").className = "inline-msg";
  loadMessages();
}
$("msgSendBtn").addEventListener("click", sendMessage);
$("msgInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

/* ---------- live (native, TikTok-style) ----------
   One host broadcasts; everyone else watches; the room's text chat
   flows under the video. Signaling rides Supabase Realtime (presence
   + broadcast); the video itself goes phone-to-phone (WebRTC, STUN
   only) — free, and right for small-room seshes. */
const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const liveClientId = "c" + Math.random().toString(36).slice(2, 10);
let liveRoom = null;
let liveMode = "idle"; // idle | preview | host | viewer
let liveChannel = null;
let localStream = null;
let viewerPc = null;           // viewer side: my connection to the host
const hostPcs = new Map();     // host side: viewerId -> connection
let currentHost = null;        // { id, name } when someone else is live
let liveChatPoll = null;

function renderLiveGrid() {
  $("liveGrid").innerHTML = ROOMS.filter((r) => r.live).map((r) => roomCard(r, null)).join("");
  $("liveGrid").querySelectorAll("[data-room]").forEach((el) =>
    el.addEventListener("click", () => openLive(el.getAttribute("data-room"))));
}

function liveStatus(t) { $("liveStatus").textContent = t; }

function openLive(id) {
  liveRoom = ROOMS.find((r) => r.id === id) || ROOMS[0];
  $("liveListView").hidden = true;
  $("liveView").hidden = false;
  $("liveTitle").textContent = liveRoom.emoji + " " + liveRoom.name + " — live sesh";
  window.scrollTo({ top: 0 });
  resetLiveStage();
  startLiveChat();
  if (!sbReady) { liveStatus("Live needs the sesh database — still setting up."); return; }
  connectLiveChannel();
}

function resetLiveStage() {
  liveMode = "idle";
  currentHost = null;
  $("liveVideo").srcObject = null;
  $("livePlaceholder").hidden = false;
  $("livePlaceholderText").textContent = "No one's live in here yet.";
  $("liveBadge").hidden = true;
  $("liveCount").textContent = "";
  $("liveMainBtn").textContent = "🔴 Go Live";
  $("liveMainBtn").className = "live-main-btn";
  setCtlIcons(false, false);
  liveStatus("Checking who's live…");
}

function setCtlIcons(micOn, camOn) {
  $("liveMicBtn").textContent = micOn ? "🎙️" : "🔇";
  $("liveMicBtn").classList.toggle("on", !!micOn);
  $("liveCamBtn").textContent = camOn ? "📷" : "📵";
  $("liveCamBtn").classList.toggle("on", !!camOn);
}

/* ----- presence: who's here, who's hosting ----- */
function connectLiveChannel() {
  liveChannel = sb.channel("sesh-live-" + liveRoom.id, {
    config: { presence: { key: liveClientId }, broadcast: { self: false } }
  });
  liveChannel.on("presence", { event: "sync" }, refreshLivePresence);
  liveChannel.on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload));
  liveChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await liveChannel.track({ role: "watcher", name: displayName || "Guest" });
      refreshLivePresence();
    }
  });
}

function refreshLivePresence() {
  if (!liveChannel) return;
  const state = liveChannel.presenceState();
  let people = 0;
  let host = null;
  Object.entries(state).forEach(([key, presences]) => {
    people += presences.length;
    presences.forEach((p) => {
      if (p.role === "host" && key !== liveClientId) host = { id: key, name: p.name || "Someone" };
    });
  });
  $("liveCount").textContent = people > 1 ? "👥 " + people + " here" : "";
  if (liveMode === "host" || liveMode === "viewer") return;
  currentHost = host;
  if (host) {
    $("livePlaceholderText").textContent = host.name + " is LIVE in here!";
    $("liveMainBtn").textContent = "▶️ Watch " + host.name;
    $("liveMainBtn").classList.add("watch");
    liveStatus(host.name + " is live — tap Watch to jump in.");
  } else {
    $("livePlaceholderText").textContent = "No one's live in here yet.";
    $("liveMainBtn").textContent = liveMode === "preview" ? "🔴 Go Live" : "🔴 Go Live";
    $("liveMainBtn").classList.remove("watch");
    if (liveMode === "idle") liveStatus("Nobody's live right now — this room is yours if you want it.");
    if (liveMode === "preview") liveStatus("That's you! Hit Go Live when you're ready.");
  }
}

/* ----- signaling ----- */
function signal(to, kind, payload) {
  if (!liveChannel) return;
  liveChannel.send({ type: "broadcast", event: "signal", payload: Object.assign({ to, from: liveClientId, kind }, payload || {}) });
}

async function onSignal(p) {
  if (!p || p.to !== liveClientId) return;
  if (p.kind === "watch" && liveMode === "host") addViewer(p.from);
  else if (p.kind === "offer" && liveMode === "viewer") await answerOffer(p);
  else if (p.kind === "answer" && liveMode === "host") {
    const pc = hostPcs.get(p.from);
    if (pc && !pc._remoteSet) { await pc.setRemoteDescription(p.sdp); pc._remoteSet = true; flushIce(pc); }
  } else if (p.kind === "ice") {
    const pc = liveMode === "host" ? hostPcs.get(p.from) : viewerPc;
    if (pc) pushIce(pc, p.candidate);
  } else if (p.kind === "bye") {
    if (liveMode === "viewer" && currentHost && p.from === currentHost.id) seshEnded("The sesh ended — thanks for hanging out.");
    if (liveMode === "host") closeHostPc(p.from);
  }
}
function pushIce(pc, candidate) {
  if (!candidate) return;
  if (pc._remoteSet) pc.addIceCandidate(candidate).catch(() => {});
  else (pc._pendingIce = pc._pendingIce || []).push(candidate);
}
function flushIce(pc) {
  (pc._pendingIce || []).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
  pc._pendingIce = [];
}

/* ----- host side ----- */
async function ensureLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const v = $("liveVideo");
  v.srcObject = localStream;
  v.muted = true; // never echo yourself
  $("livePlaceholder").hidden = true;
  setCtlIcons(true, true);
  return localStream;
}

async function goLive() {
  if (!requireName()) return;
  try {
    await ensureLocalStream();
  } catch (e) {
    liveStatus("Your camera/mic didn't open — check the browser's permission, or just watch and chat instead.");
    return;
  }
  liveMode = "host";
  $("liveBadge").hidden = false;
  $("liveMainBtn").textContent = "⏹ End Live";
  $("liveMainBtn").className = "live-main-btn end";
  liveStatus("You're LIVE 🔴 — anyone who opens this room sees you. Say hey!");
  if (liveChannel) await liveChannel.track({ role: "host", name: displayName });
}

function addViewer(viewerId) {
  if (hostPcs.has(viewerId) || !localStream) return;
  const pc = new RTCPeerConnection(STUN);
  hostPcs.set(viewerId, pc);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => { if (e.candidate) signal(viewerId, "ice", { candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) closeHostPc(viewerId);
  };
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer).then(() => signal(viewerId, "offer", { sdp: pc.localDescription })))
    .catch(() => closeHostPc(viewerId));
}
function closeHostPc(viewerId) {
  const pc = hostPcs.get(viewerId);
  if (pc) { try { pc.close(); } catch (e) {} hostPcs.delete(viewerId); }
}

async function endLive() {
  hostPcs.forEach((pc, viewerId) => { signal(viewerId, "bye", {}); try { pc.close(); } catch (e) {} });
  hostPcs.clear();
  stopLocalStream();
  if (liveChannel) await liveChannel.track({ role: "watcher", name: displayName || "Guest" });
  resetLiveStage();
  liveStatus("You ended the sesh. Hope it was a good one.");
  refreshLivePresence();
}

/* ----- viewer side ----- */
function startWatching() {
  if (!currentHost) return;
  liveMode = "viewer";
  liveStatus("Connecting to " + currentHost.name + "'s sesh…");
  $("liveMainBtn").textContent = "Leave";
  $("liveMainBtn").className = "live-main-btn end";
  signal(currentHost.id, "watch", {});
}

async function answerOffer(p) {
  closeViewerPc();
  viewerPc = new RTCPeerConnection(STUN);
  viewerPc.onicecandidate = (e) => { if (e.candidate) signal(p.from, "ice", { candidate: e.candidate }); };
  viewerPc.ontrack = (e) => {
    const v = $("liveVideo");
    v.srcObject = e.streams[0];
    v.muted = false;
    $("livePlaceholder").hidden = true;
    $("liveBadge").hidden = false;
    liveStatus("You're watching " + (currentHost ? currentHost.name : "the sesh") + " 🔴 — chat below!");
  };
  viewerPc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(viewerPc.connectionState) && liveMode === "viewer")
      seshEnded("The connection dropped — the sesh may have ended.");
  };
  await viewerPc.setRemoteDescription(p.sdp);
  viewerPc._remoteSet = true;
  flushIce(viewerPc);
  const answer = await viewerPc.createAnswer();
  await viewerPc.setLocalDescription(answer);
  signal(p.from, "answer", { sdp: viewerPc.localDescription });
}
function closeViewerPc() {
  if (viewerPc) { try { viewerPc.close(); } catch (e) {} viewerPc = null; }
}
function endWatch() {
  if (currentHost) signal(currentHost.id, "bye", {});
  closeViewerPc();
  resetLiveStage();
  liveStatus("You left the sesh.");
  refreshLivePresence();
}
function seshEnded(msg) {
  closeViewerPc();
  resetLiveStage();
  liveStatus(msg);
  refreshLivePresence();
}

/* ----- controls ----- */
function stopLocalStream() {
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  $("liveVideo").srcObject = null;
}
$("liveMainBtn").addEventListener("click", () => {
  if (liveMode === "host") endLive();
  else if (liveMode === "viewer") endWatch();
  else if (currentHost) startWatching();
  else goLive();
});
$("liveCamBtn").addEventListener("click", async () => {
  if (liveMode === "viewer") { toast("You're watching — Leave first, then Go Live to get on camera."); return; }
  if (localStream) {
    const track = localStream.getVideoTracks()[0];
    if (liveMode === "host" && track) { track.enabled = !track.enabled; setCtlIcons(localStream.getAudioTracks()[0]?.enabled, track.enabled); }
    else { stopLocalStream(); liveMode = "idle"; $("livePlaceholder").hidden = false; setCtlIcons(false, false); refreshLivePresence(); }
  } else {
    try { await ensureLocalStream(); liveMode = "preview"; liveStatus("That's you! Hit Go Live when you're ready."); }
    catch (e) { liveStatus("Camera didn't open — you can still watch and chat."); }
  }
});
$("liveMicBtn").addEventListener("click", () => {
  if (!localStream) { toast("Turn your camera on first — the mic comes with it."); return; }
  const track = localStream.getAudioTracks()[0];
  if (track) { track.enabled = !track.enabled; setCtlIcons(track.enabled, localStream.getVideoTracks()[0]?.enabled); }
});

function teardownLive() {
  if (liveMode === "host") { hostPcs.forEach((pc) => { try { pc.close(); } catch (e) {} }); hostPcs.clear(); }
  closeViewerPc();
  stopLocalStream();
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (liveChatPoll) { clearInterval(liveChatPoll); liveChatPoll = null; }
  liveRoom = null;
  liveMode = "idle";
}
$("backLiveBtn").addEventListener("click", () => {
  teardownLive();
  $("liveView").hidden = true;
  $("liveListView").hidden = false;
});

/* ----- live chat (same room messages as the Rooms tab) ----- */
let liveChatMsgs = [];
async function startLiveChat() {
  await loadLiveChat();
  if (liveChatPoll) clearInterval(liveChatPoll);
  liveChatPoll = setInterval(loadLiveChat, 4000);
}
async function loadLiveChat() {
  if (!liveRoom || !sbReady) return;
  const { data, error } = await sb.from("sesh_messages").select("*")
    .eq("room_id", liveRoom.id).order("created_at", { ascending: true }).limit(100);
  if (error) return;
  liveChatMsgs = data || [];
  $("liveChatEmpty").hidden = liveChatMsgs.length > 0;
  $("liveChatList").innerHTML = liveChatMsgs.map((m) => `
    <div class="msg ${displayName && m.author_name === displayName ? "mine" : ""}">
      <span class="avatar">${esc(initials(m.author_name))}</span>
      <span class="msg-body">
        <span class="msg-name">${esc(m.author_name)}<span class="msg-time">${timeAgo(m.created_at)}</span></span><br>
        <span class="msg-text">${esc(m.content)}</span>
      </span>
    </div>`).join("");
}
async function sendLiveChat() {
  if (!requireName() || !liveRoom) return;
  const content = $("liveChatInput").value.trim();
  if (!content) return;
  $("liveChatInput").value = "";
  const { error } = await sb.from("sesh_messages")
    .insert({ room_id: liveRoom.id, author_name: displayName, content });
  if (error) { toast("Message didn't send — check your signal."); return; }
  loadLiveChat();
}
$("liveChatSend").addEventListener("click", sendLiveChat);
$("liveChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendLiveChat(); });

/* ---------- go ---------- */
refreshNameChip();
renderRoomGrid(null);
renderLiveGrid();
if (sbReady) {
  loadFeed();
  loadRoomCounts();
} else {
  $("feedMsg").textContent = "The sesh is still setting up — check back in a minute.";
}
