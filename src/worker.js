const APP_HTML_PATH = "public/index.html";
const APP_JS_PATH = "public/app.js";
const APP_CSS_PATH = "public/style.css";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    if (url.pathname === "/") return serveStatic(APP_HTML_PATH, "text/html; charset=utf-8");
    if (url.pathname === "/app.js") return serveStatic(APP_JS_PATH, "application/javascript; charset=utf-8");
    if (url.pathname === "/style.css") return serveStatic(APP_CSS_PATH, "text/css; charset=utf-8");

    if (url.pathname === "/api/login" && request.method === "POST") return handleLogin(request);
    if (url.pathname === "/api/libraries" && request.method === "GET") return handleLibraries(request);
    if (url.pathname === "/api/items" && request.method === "GET") return handleItems(request);
    if (url.pathname === "/api/playback" && request.method === "GET") return handlePlayback(request);
    if (url.pathname === "/api/stream" && request.method === "GET") return handleStream(request);
    if (url.pathname === "/api/image" && request.method === "GET") return handleImage(request);

    return withCors(json({ error: "Not Found" }, 404));
  },
};

async function serveStatic(path, contentType) {
  const content = STATIC_CONTENT[path];
  if (!content) return withCors(json({ error: `Missing static file: ${path}` }, 500));
  return withCors(new Response(content, { headers: { "content-type": contentType } }));
}

async function handleLogin(request) {
  try {
    const { server, username, password } = (await request.json()) || {};
    if (!server || !username) return withCors(json({ error: "Missing server/username" }, 400));
    const cleanServer = normalizeServer(server);

    const resp = await fetch(`${cleanServer}/Users/AuthenticateByName`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-emby-authorization": buildAuthHeader() },
      body: JSON.stringify({ Username: username, Pw: password ?? "" }),
    });
    const payload = await safeJson(resp);
    if (!resp.ok) return withCors(json({ error: "Login failed", detail: payload }, resp.status));

    return withCors(
      json({
        server: cleanServer,
        token: payload?.AccessToken,
        userId: payload?.User?.Id,
        userName: payload?.User?.Name,
      })
    );
  } catch (e) {
    return withCors(json({ error: "Login exception", detail: String(e) }, 500));
  }
}

async function handleLibraries(request) {
  const auth = readAuthFromRequest(request);
  if (!auth.ok) return auth.response;
  const { server, token, userId } = auth.data;
  const resp = await fetch(`${server}/Users/${encodeURIComponent(userId)}/Views`, { headers: embyHeaders(token) });
  const payload = await safeJson(resp);
  if (!resp.ok) return withCors(json({ error: "Failed to fetch libraries", detail: payload }, resp.status));
  return withCors(json(payload));
}

async function handleItems(request) {
  const auth = readAuthFromRequest(request);
  if (!auth.ok) return auth.response;
  const { server, token, userId } = auth.data;
  const url = new URL(request.url);
  const parentId = url.searchParams.get("parentId");
  if (!parentId) return withCors(json({ error: "Missing parentId" }, 400));

  const endpoint = new URL(`${server}/Users/${encodeURIComponent(userId)}/Items`);
  endpoint.searchParams.set("ParentId", parentId);
  endpoint.searchParams.set("Recursive", "false");
  endpoint.searchParams.set("Fields", "Overview,PrimaryImageAspectRatio,SeriesId,ParentId,MediaSources,Path");
  endpoint.searchParams.set("SortBy", "SortName");
  endpoint.searchParams.set("SortOrder", "Ascending");

  const resp = await fetch(endpoint, { headers: embyHeaders(token) });
  const payload = await safeJson(resp);
  if (!resp.ok) return withCors(json({ error: "Failed to fetch items", detail: payload }, resp.status));
  return withCors(json(payload));
}

async function handlePlayback(request) {
  const auth = readAuthFromRequest(request, { allowQueryAuth: true });
  if (!auth.ok) return auth.response;
  const { server, token, userId } = auth.data;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) return withCors(json({ error: "Missing itemId" }, 400));

  const endpoint = `${server}/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${encodeURIComponent(userId)}`;
  const resp = await fetch(endpoint, { headers: embyHeaders(token) });
  const payload = await safeJson(resp);
  if (!resp.ok) return withCors(json({ error: "Failed to fetch playback info", detail: payload }, resp.status));
  return withCors(json(payload));
}

async function handleStream(request) {
  const auth = readAuthFromRequest(request, { allowQueryAuth: true });
  if (!auth.ok) return auth.response;
  const { server, token, userId } = auth.data;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const mediaSourceId = url.searchParams.get("mediaSourceId") || "";
  const mode = url.searchParams.get("mode") || "hls";
  const subtitleStreamIndex = url.searchParams.get("SubtitleStreamIndex") || "";

  if (!itemId) return withCors(json({ error: "Missing itemId" }, 400));

  const endpoint = new URL(
    mode === "hls"
      ? `${server}/Videos/${encodeURIComponent(itemId)}/master.m3u8`
      : `${server}/Videos/${encodeURIComponent(itemId)}/stream`
  );
  endpoint.searchParams.set("api_key", token);
  endpoint.searchParams.set("UserId", userId);
  if (mediaSourceId) endpoint.searchParams.set("MediaSourceId", mediaSourceId);
  if (subtitleStreamIndex) endpoint.searchParams.set("SubtitleStreamIndex", subtitleStreamIndex);
  if (mode !== "hls") endpoint.searchParams.set("static", "true");

  const upstream = await fetch(endpoint, { method: "GET", headers: passThroughHeaders(request) });
  const headers = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleImage(request) {
  const auth = readAuthFromRequest(request, { allowQueryAuth: true });
  if (!auth.ok) return auth.response;
  const { server, token } = auth.data;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const type = url.searchParams.get("type") || "Primary";
  if (!itemId) return withCors(json({ error: "Missing itemId" }, 400));

  const endpoint = new URL(`${server}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}`);
  endpoint.searchParams.set("maxWidth", "600");
  endpoint.searchParams.set("quality", "90");
  endpoint.searchParams.set("tag", url.searchParams.get("tag") || "");
  endpoint.searchParams.set("api_key", token);

  const upstream = await fetch(endpoint);
  const headers = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers });
}

function readAuthFromRequest(request, options = {}) {
  const url = new URL(request.url);
  const allowQueryAuth = Boolean(options.allowQueryAuth);
  const server = request.headers.get("x-emby-server") || (allowQueryAuth ? url.searchParams.get("server") : null);
  const token = request.headers.get("x-emby-token") || (allowQueryAuth ? url.searchParams.get("token") : null);
  const userId = request.headers.get("x-emby-userid") || (allowQueryAuth ? url.searchParams.get("userId") : null);
  if (!server || !token || !userId) return { ok: false, response: withCors(json({ error: "Missing auth headers" }, 401)) };
  return { ok: true, data: { server: normalizeServer(server), token, userId } };
}

function embyHeaders(token) {
  return { "x-emby-token": token, "x-emby-authorization": buildAuthHeader() };
}

function passThroughHeaders(request) {
  const headers = {};
  const range = request.headers.get("range");
  if (range) headers.range = range;
  return headers;
}

function normalizeServer(server) {
  return String(server).trim().replace(/\/$/, "");
}

function buildAuthHeader() {
  return 'MediaBrowser Client="CFEmbyPlayer", Device="Browser", DeviceId="cfemby-player", Version="2.0.0"';
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Emby-Server, X-Emby-Token, X-Emby-UserId, Range",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  };
}
function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
async function safeJson(resp) {
  try { return await resp.json(); } catch { return { raw: await resp.text() }; }
}

const STATIC_CONTENT = {
  [APP_HTML_PATH]: `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CF Emby Player</title><link rel="stylesheet" href="/style.css"/></head><body>
<header><h1>CF Emby Player</h1><p>海报 / 选集 / 字幕 / 播放</p></header>
<section class="card" id="loginCard"><form id="loginForm"><input id="server" placeholder="https://emby.example.com" required/><input id="username" placeholder="用户名" required/><input id="password" type="password" placeholder="密码（可空）"/><button type="submit">登录</button></form></section>
<section class="card hidden" id="mainCard"><div class="toolbar"><button id="backBtn">返回上级</button><button id="logoutBtn">退出</button></div><h2 id="pathTitle">媒体库</h2><div id="grid" class="grid"></div></section>
<section class="card hidden" id="playerCard"><h2 id="nowPlaying">未播放</h2><video id="video" controls playsinline></video><div class="row"><select id="episodeSelect"></select><select id="subtitleSelect"></select><button id="applySubtitle">应用字幕</button></div></section>
<p id="status"></p><script src="/app.js"></script></body></html>`,
  [APP_JS_PATH]: `(() => {
  const state = {
    server: localStorage.getItem("emby_server") || "",
    token: localStorage.getItem("emby_token") || "",
    userId: localStorage.getItem("emby_userId") || "",
    stack: [],
    currentItems: [],
    currentPlayable: null,
  };

  const dom = {
    loginForm: qs("#loginForm"), server: qs("#server"), username: qs("#username"), password: qs("#password"),
    loginCard: qs("#loginCard"), mainCard: qs("#mainCard"), playerCard: qs("#playerCard"),
    grid: qs("#grid"), pathTitle: qs("#pathTitle"), status: qs("#status"), video: qs("#video"), nowPlaying: qs("#nowPlaying"),
    episodeSelect: qs("#episodeSelect"), subtitleSelect: qs("#subtitleSelect"), applySubtitle: qs("#applySubtitle"),
    backBtn: qs("#backBtn"), logoutBtn: qs("#logoutBtn")
  };

  function qs(s) { return document.querySelector(s); }
  function setStatus(t) { dom.status.textContent = t; }
  function authHeaders() { return { "x-emby-server": state.server, "x-emby-token": state.token, "x-emby-userid": state.userId }; }
  function authedFetch(url) { return fetch(url, { headers: authHeaders() }); }
  function save() { localStorage.setItem("emby_server", state.server); localStorage.setItem("emby_token", state.token); localStorage.setItem("emby_userId", state.userId); }
  function clearSession() { ["emby_token", "emby_userId"].forEach(k => localStorage.removeItem(k)); state.token = ""; state.userId = ""; }

  function showMain() { dom.loginCard.classList.add("hidden"); dom.mainCard.classList.remove("hidden"); }

  function bind() {
    dom.loginForm.addEventListener("submit", onLogin);
    dom.backBtn.addEventListener("click", goBack);
    dom.logoutBtn.addEventListener("click", () => { clearSession(); location.reload(); });
    dom.episodeSelect.addEventListener("change", () => {
      const id = dom.episodeSelect.value;
      const ep = state.currentItems.find(x => x.Id === id);
      if (ep) playItem(ep);
    });
    dom.applySubtitle.addEventListener("click", applySubtitle);
  }

  async function onLogin(e) {
    e.preventDefault();
    try {
      setStatus("登录中...");
      const payload = { server: dom.server.value.trim(), username: dom.username.value.trim(), password: dom.password.value || "" };
      if (!payload.server || !payload.username) return setStatus("请填写服务器地址和用户名");

      const resp = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return setStatus("登录失败: " + (data.error || resp.status));

      state.server = data.server || payload.server;
      state.token = data.token || "";
      state.userId = data.userId || "";
      if (!state.token || !state.userId) return setStatus("登录失败: Emby 未返回 token/userId");

      save();
      showMain();
      await loadLibraries();
      setStatus("登录成功");
    } catch (err) {
      setStatus("登录异常: " + String(err));
      console.error(err);
    }
  }

  async function loadLibraries() {
    setStatus("加载媒体库...");
    const r = await authedFetch("/api/libraries");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus("加载媒体库失败: " + (d.error || r.status));
    render(d.Items || [], "媒体库");
  }

  async function openItem(item) {
    if (["Movie", "Episode"].includes(item.Type) || item.MediaType === "Video") return playItem(item);
    state.stack.push(item);
    dom.pathTitle.textContent = item.Name;
    setStatus("加载: " + item.Name);
    const r = await authedFetch("/api/items?parentId=" + encodeURIComponent(item.Id));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus("加载失败: " + (d.error || r.status));
    render(d.Items || [], item.Name);
  }

  function goBack() {
    if (!state.stack.length) return loadLibraries();
    state.stack.pop();
    if (!state.stack.length) return loadLibraries();
    openItem(state.stack[state.stack.length - 1]);
  }

  function cardImageUrl(it) {
    const targetId = it.Type === "Episode" ? (it.SeriesId || it.Id) : it.Id;
    return "/api/image?itemId=" + encodeURIComponent(targetId) + "&type=Primary&server=" + encodeURIComponent(state.server) + "&token=" + encodeURIComponent(state.token) + "&userId=" + encodeURIComponent(state.userId);
  }

  function render(items, title) {
    state.currentItems = items;
    dom.pathTitle.textContent = title;
    dom.grid.innerHTML = "";
    items.forEach(it => {
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = "<img src=\"" + cardImageUrl(it) + "\" onerror=\"this.src='https://dummyimage.com/320x180/222/aaa&text=No+Image'\"/><div class='meta'><b>" + it.Name + "</b><small>" + (it.Type || "Unknown") + "</small></div>";
      el.addEventListener("click", () => openItem(it));
      dom.grid.appendChild(el);
    });
    setStatus("共 " + items.length + " 项");
  }

  async function playItem(item) {
    state.currentPlayable = item;
    dom.playerCard.classList.remove("hidden");
    dom.nowPlaying.textContent = "正在播放: " + item.Name;
    const ms = item.MediaSources?.[0]?.Id || "";
    const p = new URLSearchParams({ itemId: item.Id, server: state.server, token: state.token, userId: state.userId, mode: "hls" });
    if (ms) p.set("mediaSourceId", ms);
    dom.video.src = "/api/stream?" + p.toString();
    dom.video.play().catch(() => {});

    const infoResp = await fetch("/api/playback?" + new URLSearchParams({ itemId: item.Id, server: state.server, token: state.token, userId: state.userId }));
    const info = await infoResp.json().catch(() => ({}));
    const src = info?.MediaSources?.[0];
    renderEpisodeSelector();
    renderSubtitleSelector(src);

    dom.video.onerror = () => {
      const p2 = new URLSearchParams({ itemId: item.Id, server: state.server, token: state.token, userId: state.userId, mode: "direct" });
      if (ms) p2.set("mediaSourceId", ms);
      dom.video.src = "/api/stream?" + p2.toString();
    };
  }

  function renderEpisodeSelector() {
    const eps = state.currentItems.filter(x => x.Type === "Episode");
    dom.episodeSelect.innerHTML = "";
    if (!eps.length) { dom.episodeSelect.innerHTML = "<option>当前层级无可选集</option>"; return; }
    eps.forEach(e => {
      const op = document.createElement("option");
      op.value = e.Id;
      op.textContent = e.IndexNumber ? ("E" + e.IndexNumber + " " + e.Name) : e.Name;
      if (state.currentPlayable && state.currentPlayable.Id === e.Id) op.selected = true;
      dom.episodeSelect.appendChild(op);
    });
  }

  function renderSubtitleSelector(ms) {
    dom.subtitleSelect.innerHTML = "";
    const subs = (ms?.MediaStreams || []).filter(s => s.Type === "Subtitle");
    if (!subs.length) { dom.subtitleSelect.innerHTML = "<option value=''>无字幕</option>"; return; }
    dom.subtitleSelect.innerHTML = "<option value=''>关闭字幕</option>";
    subs.forEach(s => {
      const op = document.createElement("option");
      op.value = String(s.Index);
      op.textContent = (s.DisplayTitle || s.Language || "字幕") + " (" + (s.Codec || "") + ")";
      dom.subtitleSelect.appendChild(op);
    });
  }

  function applySubtitle() {
    if (!state.currentPlayable) return;
    const ms = state.currentPlayable.MediaSources?.[0]?.Id || "";
    const sub = dom.subtitleSelect.value;
    const p = new URLSearchParams({ itemId: state.currentPlayable.Id, server: state.server, token: state.token, userId: state.userId, mode: "hls" });
    if (ms) p.set("mediaSourceId", ms);
    if (sub) p.set("SubtitleStreamIndex", sub);
    dom.video.src = "/api/stream?" + p.toString();
    dom.video.play().catch(() => {});
  }

  function init() {
    dom.server.value = state.server;
    bind();
    if (state.server && state.token && state.userId) { showMain(); loadLibraries(); }
  }

  init();
})();
`,
  [APP_CSS_PATH]: `body{margin:0;padding:16px;background:#0f1115;color:#eee;font-family:system-ui}header h1{margin:0}header p{opacity:.8}.card{background:#1a1f29;border:1px solid #2b3340;border-radius:12px;padding:12px;margin-top:12px}.hidden{display:none}input,button,select{padding:10px;border-radius:8px;border:1px solid #3a4352;background:#10151d;color:#fff}#loginForm{display:grid;gap:8px}.toolbar{display:flex;gap:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.item{cursor:pointer;background:#11161f;border:1px solid #313b4a;border-radius:10px;overflow:hidden}.item img{width:100%;height:220px;object-fit:cover;display:block}.item .meta{padding:8px;display:grid}.item small{opacity:.7}video{width:100%;max-height:62vh;background:#000;border-radius:8px}.row{margin-top:10px;display:grid;grid-template-columns:1fr 1fr auto;gap:8px}#status{margin-top:10px;color:#8ab4ff}`,
};
