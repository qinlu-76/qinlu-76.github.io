const SITE = window.SITE_INFO || {};
const $ = (sel) => document.querySelector(sel);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));

/* ---------- 数据 ---------- */
const EMPTY_DATA = { photos: [], videos: [], albums: [], files: [] };

let data = normalizeData(window.MEDIA_DATA || EMPTY_DATA);
let items = [];
let albums = [];
let readOnly = true;

const EMPTY_ALBUMS_KEY = "archive:emptyAlbums";

function loadEmptyAlbums() {
  try {
    const raw = JSON.parse(localStorage.getItem(EMPTY_ALBUMS_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((name) => typeof name === "string" && name.trim()).slice(0, 300)
      : [];
  } catch (err) {
    return [];
  }
}

let emptyAlbums = loadEmptyAlbums();

let currentList = [];
const state = { album: "all", type: "all", q: "" };

function normalizeData(raw) {
  return {
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    videos: Array.isArray(raw.videos) ? raw.videos : [],
    albums: Array.isArray(raw.albums) ? raw.albums : [],
    files: Array.isArray(raw.files) ? raw.files : [],
  };
}

function rebuild() {
  items = [
    ...data.photos.map((p) => ({ ...p, type: "photo" })),
    ...data.videos.map((v) => ({ ...v, type: "video" })),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  albums = (data.albums.length ? data.albums : deriveAlbums()).slice();

  const names = new Set(albums.map((album) => album.name));
  emptyAlbums.forEach((name) => {
    if (!names.has(name)) {
      names.add(name);
      albums.push({ name, count: 0, cover: "" });
    }
  });

  albums.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

function deriveAlbums() {
  const map = new Map();
  items.forEach((item) => {
    const entry = map.get(item.album) || { name: item.album, count: 0, cover: "" };
    entry.count += 1;
    if (!entry.cover && item.type === "photo") entry.cover = item.src;
    map.set(item.album, entry);
  });
  return [...map.values()];
}

function applyData(next) {
  data = normalizeData(next);
  rebuild();
  if (state.album !== "all" && !albums.some((album) => album.name === state.album)) {
    state.album = "all";
  }
  renderStats();
  renderAlbums();
  renderChips();
  renderGallery();
  renderCollage();
  renderFiles();
  updateAlbumOptions();
  observeReveals();
}

const itemKey = (item) => `${item.type}|${item.src}`;

/* ---------- 操作提示 ---------- */
const toastEl = $("#toast");
let toastTimer = null;

function toast(message, isError) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle("error", Boolean(isError));
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

/* ---------- 个人信息 ---------- */
function applySite() {
  const name = SITE.name || "你的名字";
  document.title = `${name} · 个人影像档案`;
  $("#siteName").textContent = name;
  $("#footerName").textContent = name;

  const title = SITE.title || "记录生活里的\n每一帧光影";
  $("#heroTitle").innerHTML = esc(title).replace(/\n/g, "<br />");
  $("#heroTagline").textContent = SITE.tagline || "这里保存着我的照片、视频和重要文件。";

  const about = String(SITE.about || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (about.length) {
    $("#aboutText").innerHTML = about.map((p) => `<p>${esc(p)}</p>`).join("");
  }

  if (SITE.email) {
    const mail = $("#contactEmail");
    mail.href = `mailto:${SITE.email}`;
    mail.querySelector("b").textContent = SITE.email;
  }

  if (SITE.github) {
    const gh = $("#contactGithub");
    gh.href = SITE.github;
    gh.querySelector("b").textContent = "@" + SITE.github.replace(/[#?].*$/, "").replace(/\/+$/, "").split("/").pop();
  }

  $("#year").textContent = new Date().getFullYear();
}

/* ---------- 统计 ---------- */
function renderStats() {
  $("#statPhotos").textContent = data.photos.length;
  $("#statVideos").textContent = data.videos.length;
  $("#statAlbums").textContent = albums.length;
  $("#statFiles").textContent = data.files.length;
}

/* ---------- 相册 ---------- */
function renderAlbums() {
  const grid = $("#albumGrid");

  if (!albums.length) {
    grid.innerHTML = `<div class="empty"><strong>还没有相册</strong><span>点击「上传」添加照片和视频，或把文件放进 <code>media/photos/相册名/</code> 后运行 <code>node tools/scan-media.js</code>。</span></div>`;
    return;
  }

  grid.innerHTML = albums.map((album) => `
    <button type="button" class="album-card reveal" data-album="${esc(album.name)}">
      ${album.cover
        ? `<img src="${esc(album.cover)}" alt="${esc(album.name)}" loading="lazy" data-fallback="${esc(album.name)}" />`
        : album.count === 0
          ? `<div class="ph-placeholder album-empty-cover" style="position:static;width:100%;height:100%">
               <span class="album-empty-icon">+</span>
               <span class="album-empty-hint">空相册</span>
             </div>`
          : `<div class="ph-placeholder" style="position:static;width:100%;height:100%">${esc(album.name)}</div>`}
      <div class="album-meta">
        <strong>${esc(album.name)}</strong>
        <span>${album.count ? `${album.count} 项影像` : "空相册 · 点击上传"}</span>
      </div>
    </button>`).join("");

  grid.querySelectorAll(".album-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.album = card.dataset.album;
      $("#albumInput").value = card.dataset.album;
      renderChips();
      renderGallery();
      location.hash = "#gallery";
    });
  });
}

function saveEmptyAlbums() {
  try {
    localStorage.setItem(EMPTY_ALBUMS_KEY, JSON.stringify(emptyAlbums));
  } catch (err) {
    /* 隐私模式忽略 */
  }
}

function openAlbumCreate() {
  $("#albumCreateBox").hidden = false;
  $("#createAlbumBtn").classList.add("active");
  const input = $("#albumCreateName");
  input.value = "";
  input.focus();
}

function closeAlbumCreate() {
  $("#albumCreateBox").hidden = true;
  $("#createAlbumBtn").classList.remove("active");
  $("#albumCreateName").value = "";
}

function createAlbumFromGrid() {
  const input = $("#albumCreateName");
  const name = cleanAlbumName(input.value);
  if (!name) {
    toast("请先输入相册名称。", true);
    input.focus();
    return;
  }
  if (albums.some((album) => album.name === name)) {
    toast(`相册「${name}」已经存在，点击卡片即可上传。`, true);
    input.focus();
    return;
  }

  emptyAlbums.push(name);
  saveEmptyAlbums();
  rebuild();
  renderStats();
  renderAlbums();
  $("#albumGrid").querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
  renderChips();
  updateAlbumOptions();
  closeAlbumCreate();
  toast(`已创建相册「${name}」，点击卡片上传照片或视频。`);
}

function bindAlbumCreate() {
  $("#createAlbumBtn").addEventListener("click", () => {
    if ($("#albumCreateBox").hidden) openAlbumCreate();
    else closeAlbumCreate();
  });
  $("#albumCreateConfirm").addEventListener("click", createAlbumFromGrid);
  $("#albumCreateCancel").addEventListener("click", closeAlbumCreate);
  $("#albumCreateName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createAlbumFromGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAlbumCreate();
    }
  });
}

/* ---------- 筛选条 ---------- */
function renderChips() {
  const chips = [{ name: "all", label: "全部相册" }, ...albums.map((a) => ({ name: a.name, label: a.name }))];

  $("#albumChips").innerHTML = chips.map((chip) => `
    <button type="button" class="chip${state.album === chip.name ? " active" : ""}" data-album="${esc(chip.name)}">
      ${esc(chip.label)}
    </button>`).join("");

  $("#albumChips").querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.album = chip.dataset.album;
      renderChips();
      renderGallery();
    });
  });
}

function bindTypeFilter() {
  $("#typeFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    state.type = btn.dataset.type;
    $("#typeFilter").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    renderGallery();
  });
}

function bindSearch() {
  let timer;
  $("#searchInput").addEventListener("input", (e) => {
    const value = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = value;
      renderGallery();
    }, 150);
  });
}

/* ---------- 影像网格 ---------- */
function filteredItems() {
  const q = state.q.trim().toLowerCase();
  return items.filter((item) =>
    (state.album === "all" || item.album === state.album) &&
    (state.type === "all" || item.type === state.type) &&
    (!q || `${item.title || ""} ${item.album || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(q))
  );
}

function monthKey(date) {
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "unknown";
}

function monthLabel(key) {
  if (key === "unknown") return "未标日期";
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function deleteBtnHTML(key, label) {
  return `<button type="button" class="tile-del" data-key="${key}" title="删除" aria-label="删除 ${label}">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
  </button>`;
}

function tileHTML(item) {
  const label = esc(item.title || "");
  const key = esc(itemKey(item));

  if (item.type === "video") {
    const poster = item.poster
      ? `<img src="${esc(item.poster)}" alt="${label}" loading="lazy" data-fallback="${label}" />`
      : `<div class="ph-placeholder">视频</div>`;
    return `<div class="tile-wrap">
      <button type="button" class="tile video" data-key="${key}" title="${label}" aria-label="播放视频 ${label}">
        ${poster}
        <span class="tile-badge">视频</span>
        <span class="play"><span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></span></span>
        <span class="tile-caption">${label}</span>
      </button>
      ${deleteBtnHTML(key, label)}
    </div>`;
  }

  return `<div class="tile-wrap">
    <button type="button" class="tile" data-key="${key}" title="${label}" aria-label="查看图片 ${label}">
      <img src="${esc(item.src)}" alt="${label}" loading="lazy" decoding="async" data-fallback="${label}" />
      <span class="tile-caption">${label}</span>
    </button>
    ${deleteBtnHTML(key, label)}
  </div>`;
}

function renderGallery() {
  currentList = filteredItems();
  const grid = $("#mediaGrid");
  const empty = $("#galleryEmpty");

  if (!currentList.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    if (!items.length) {
      empty.innerHTML = `<strong>还没有影像</strong>
        <span>点击右上角「上传」添加照片和视频，<br />
        或把文件放进 <code>media/</code> 文件夹后运行 <code>node tools/scan-media.js</code>。</span>`;
    } else {
      empty.innerHTML = `<strong>没有符合筛选条件的影像</strong>
        <span>换个关键词，或者清除当前的相册 / 类型筛选。</span>
        <p><button type="button" class="btn btn-ghost" id="clearFilters">清除筛选</button></p>`;
      $("#clearFilters").addEventListener("click", resetFilters);
    }
    return;
  }

  empty.hidden = true;

  const groups = new Map();
  currentList.forEach((item) => {
    const key = monthKey(item.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const sortedKeys = [...groups.keys()].sort((a, b) => (a === "unknown" ? 1 : b === "unknown" ? -1 : b.localeCompare(a)));

  grid.innerHTML = sortedKeys.map((key) => {
    const group = groups.get(key);
    return `<section class="month-group reveal">
      <h3 class="month-title">${esc(monthLabel(key))} <span class="count">${group.length} 项</span></h3>
      <div class="media-grid">${group.map(tileHTML).join("")}</div>
    </section>`;
  }).join("");

  grid.querySelectorAll(".tile-wrap").forEach((wrap) => {
    const tile = wrap.querySelector(".tile");
    const del = wrap.querySelector(".tile-del");

    tile.addEventListener("click", () => {
      const index = currentList.findIndex((item) => itemKey(item) === tile.dataset.key);
      openLightbox(index);
    });

    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = currentList.find((entry) => itemKey(entry) === del.dataset.key);
      if (item) deleteMedia(item, del);
    });
  });

  observeReveals(grid);
}

function resetFilters() {
  state.album = "all";
  state.type = "all";
  state.q = "";
  $("#searchInput").value = "";
  $("#typeFilter").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.type === "all"));
  renderChips();
  renderGallery();
}

/* ---------- Hero 拼贴 ---------- */
function renderCollage() {
  const photos = items.filter((item) => item.type === "photo").slice(0, 3);
  const labels = ["影像", "档案", "记录"];

  $("#heroCollage").innerHTML = labels.map((label, i) => {
    const photo = photos[i];
    return `<div class="polaroid"><span class="holo-tag">IMG_0${i + 1} // ${label}</span>${photo
      ? `<img src="${esc(photo.src)}" alt="" loading="lazy" data-fallback="${esc(photo.title || label)}" />`
      : `<div class="ph-placeholder">${label}</div>`}</div>`;
  }).join("");
}

/* ---------- 首页星空 ---------- */
function initHeroCanvas() {
  const canvas = $("#heroCanvas");
  const hero = $("#home");
  if (!canvas || !hero) return;

  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let stars = [];
  let shoot = null;
  let raf = 0;
  let lastTime = 0;
  let visible = true;
  let running = false;

  function makeStars() {
    const count = Math.min(150, Math.max(40, Math.round((width * height) / 9000)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.4 + 0.3,
      vx: (Math.random() - 0.5) * 0.08,
      vy: Math.random() * 0.12 + 0.02,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.8 + 0.4,
      tint: Math.random() < 0.15 ? "232,121,249" : Math.random() < 0.4 ? "103,232,249" : "255,255,255",
    }));
  }

  function drawStatic() {
    ctx.clearRect(0, 0, width, height);
    for (const s of stars) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${s.tint},${0.35 + s.r * 0.22})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(time) {
    running = true;
    if (!visible) return;
    if (!lastTime) lastTime = time;
    const dt = Math.min(40, time - lastTime) / 16.67;
    lastTime = time;
    ctx.clearRect(0, 0, width, height);

    for (const s of stars) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > height + 4) {
        s.y = -4;
        s.x = Math.random() * width;
      }
      if (s.x < -4) s.x = width + 4;
      if (s.x > width + 4) s.x = -4;
      s.phase += 0.02 * s.speed * dt;
      const alpha = 0.25 + Math.abs(Math.sin(s.phase)) * 0.55;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${s.tint},${alpha.toFixed(3)})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!shoot && Math.random() < 0.004) {
      shoot = {
        x: Math.random() * width * 0.7,
        y: -20,
        vx: 2.2 + Math.random() * 1.6,
        vy: 1.4 + Math.random(),
        life: 0,
        max: 90,
      };
    }
    if (shoot) {
      shoot.x += shoot.vx * dt;
      shoot.y += shoot.vy * dt;
      shoot.life += dt;
      const fade = Math.max(0, 1 - shoot.life / shoot.max);
      const grad = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - 70, shoot.y - 45);
      grad.addColorStop(0, `rgba(190,245,255,${(0.85 * fade).toFixed(3)})`);
      grad.addColorStop(1, "rgba(103,232,249,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(shoot.x, shoot.y);
      ctx.lineTo(shoot.x - 70, shoot.y - 45);
      ctx.stroke();
      if (shoot.life > shoot.max || shoot.x > width + 100 || shoot.y > height + 100) shoot = null;
    }

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (reduce || !visible || running) return;
    lastTime = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    drawStatic();
  }

  function resize() {
    const box = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeStars();
    drawStatic();
  }

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  });
  io.observe(hero);

  window.addEventListener("resize", resize);
  resize();
}

function initHeroParallax() {
  const hero = $("#home");
  if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  hero.addEventListener("pointermove", (e) => {
    const rect = hero.getBoundingClientRect();
    hero.style.setProperty("--px", ((e.clientX - rect.left) / rect.width - 0.5).toFixed(3));
    hero.style.setProperty("--py", ((e.clientY - rect.top) / rect.height - 0.5).toFixed(3));
  });
  hero.addEventListener("pointerleave", () => {
    hero.style.setProperty("--px", "0");
    hero.style.setProperty("--py", "0");
  });
}

/* ---------- 文件 ---------- */
const EXT_CLASS = {
  pdf: "pdf", doc: "doc", docx: "doc", ppt: "doc", pptx: "doc",
  xls: "xls", xlsx: "xls", csv: "xls",
  zip: "zip", rar: "zip", "7z": "zip", gz: "zip",
};

function renderFiles() {
  const files = data.files;
  const list = $("#filesList");
  const empty = $("#filesEmpty");

  if (!files.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  list.innerHTML = files.map((file) => {
    const ext = String((file.name.split(".").pop() || "").toLowerCase());
    const extLabel = esc(ext.slice(0, 4).toUpperCase() || "文件");
    const extClass = EXT_CLASS[ext] || "";
    return `<a class="file-row reveal" href="${esc(file.href)}" download>
      <span class="file-ext ${extClass}">${extLabel}</span>
      <span>
        <span class="file-name">${esc(file.title || file.name)}</span>
        <span class="file-meta">${esc(file.date || "")}</span>
      </span>
      <span class="file-size">${esc(file.size || "")}</span>
      <svg class="file-dl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>
    </a>`;
  }).join("");

  observeReveals(list);
}

/* ---------- 灯箱 ---------- */
const lightbox = $("#lightbox");
let lbIndex = -1;
let lastFocus = null;

function openLightbox(index) {
  if (index < 0 || index >= currentList.length) return;
  lbIndex = index;
  lastFocus = document.activeElement;
  renderLightbox();
  lightbox.classList.add("open");
  document.body.classList.add("no-scroll");
  $("#lbClose").focus();
}

function renderLightbox() {
  const item = currentList[lbIndex];
  if (!item) return;

  const media = $("#lbMedia");
  media.innerHTML = "";

  let node;
  if (item.type === "video") {
    node = document.createElement("video");
    node.src = item.src;
    node.controls = true;
    node.autoplay = true;
    node.playsInline = true;
    if (item.poster) node.poster = item.poster;
  } else {
    node = document.createElement("img");
    node.src = item.src;
    node.alt = item.title || "";
  }
  media.appendChild(node);

  $("#lbCounter").textContent = `${lbIndex + 1} / ${currentList.length}`;
  $("#lbTitle").textContent = item.title || "";
  $("#lbMeta").textContent = [item.album, item.date, ...(item.tags || [])].filter(Boolean).join(" · ");

  const download = $("#lbDownload");
  download.href = item.src;
  download.setAttribute("download", item.title || "");

  const single = currentList.length <= 1;
  $("#lbPrev").style.display = single ? "none" : "";
  $("#lbNext").style.display = single ? "none" : "";
}

function closeLightbox() {
  lightbox.classList.remove("open");
  document.body.classList.remove("no-scroll");
  $("#lbMedia").innerHTML = "";
  lbIndex = -1;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function stepLightbox(delta) {
  if (lbIndex < 0) return;
  lbIndex = (lbIndex + delta + currentList.length) % currentList.length;
  renderLightbox();
}

async function deleteMedia(item, trigger) {
  if (!item) return;

  if (readOnly) {
    toast("线上版本为只读，如需删除请在电脑上操作。", true);
    return;
  }

  if (isFileMode()) {
    toast("双击打开网页时不能删除，请运行 node server.js 后访问网页。", true);
    return;
  }

  const ok = window.confirm(`确定删除「${item.title || "这个文件"}」吗？\n文件会同时从网站和 media 文件夹中移除，且无法恢复。`);
  if (!ok) return;

  if (trigger) trigger.disabled = true;
  try {
    const res = await fetch(`/api/media?path=${encodeURIComponent(item.src)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `服务器返回 ${res.status}`);
    if (lightbox.classList.contains("open")) closeLightbox();
    await refreshData();
    toast("已删除，文件已从网站和 media 文件夹中移除。");
  } catch (err) {
    toast("删除失败：" + (err.message || "网络错误"), true);
  } finally {
    if (trigger && trigger.isConnected) trigger.disabled = false;
  }
}

function deleteCurrent() {
  deleteMedia(currentList[lbIndex], $("#lbDelete"));
}

function bindLightbox() {
  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbDelete").addEventListener("click", deleteCurrent);
  $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
  $("#lbNext").addEventListener("click", () => stepLightbox(1));

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || e.target.matches(".lightbox-stage, .lb-media")) closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("open")) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
      else if (e.key === "Delete") {
        e.preventDefault();
        deleteCurrent();
      }
      return;
    }
    if (uploader.classList.contains("open") && e.key === "Escape") closeUploader();
  });
}

/* ---------- 图片加载失败兜底 ---------- */
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!img || img.tagName !== "IMG") return;
  const holder = document.createElement("div");
  holder.className = "ph-placeholder";
  holder.textContent = img.dataset.fallback || "图片缺失";
  img.replaceWith(holder);
}, true);

/* ---------- 上传 ---------- */
const PHOTO_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg", ".bmp"];
const VIDEO_EXTS = [".mp4", ".webm", ".ogv", ".mov", ".m4v"];

const uploader = $("#uploader");
const fileInput = $("#fileInput");
const dropzone = $("#dropzone");
let pending = [];
let uploading = false;

const isFileMode = () => location.protocol === "file:";

function fileKind(file) {
  const ext = "." + String(file.name.split(".").pop() || "").toLowerCase();
  if (/^image\//i.test(file.type) || PHOTO_EXTS.includes(ext)) return "photo";
  if (/^video\//i.test(file.type) || VIDEO_EXTS.includes(ext)) return "video";
  return null;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function showNote(text, isError) {
  const note = $("#uploadNote");
  note.hidden = false;
  note.textContent = text;
  note.classList.toggle("error", Boolean(isError));
}

function hideNote() {
  const note = $("#uploadNote");
  note.hidden = true;
  note.textContent = "";
}

function updateAlbumOptions() {
  $("#albumOptions").innerHTML = albums.map((album) => `<option value="${esc(album.name)}"></option>`).join("");
}

const newAlbumBox = $("#newAlbumBox");

function cleanAlbumName(raw) {
  return String(raw || "")
    .replace(/[\p{Cc}\\/:*?"<>|]+/gu, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
}

function openNewAlbum() {
  newAlbumBox.hidden = false;
  $("#newAlbumBtn").classList.add("active");
  $("#newAlbumName").value = "";
  $("#newAlbumName").focus();
}

function closeNewAlbum() {
  newAlbumBox.hidden = true;
  $("#newAlbumBtn").classList.remove("active");
  $("#newAlbumName").value = "";
}

function createAlbum() {
  const name = cleanAlbumName($("#newAlbumName").value);
  if (!name) {
    toast("请先输入相册名称。", true);
    $("#newAlbumName").focus();
    return;
  }
  $("#albumInput").value = name;
  if (albums.some((album) => album.name === name)) {
    toast(`相册「${name}」已经存在，已为你选中。`);
  } else {
    toast(`已选择新相册「${name}」，上传成功后会自动创建。`);
  }
  const options = $("#albumOptions");
  if (![...options.options].some((option) => option.value === name)) {
    options.insertAdjacentHTML("beforeend", `<option value="${esc(name)}"></option>`);
  }
  closeNewAlbum();
}

function updateConfirmButton() {
  const btn = $("#uploadConfirm");
  if (uploading) {
    btn.disabled = true;
    btn.dataset.state = "busy";
    btn.textContent = "上传中…";
    return;
  }
  const remaining = pending.filter((p) => p.status !== "done").length;
  if (pending.length && remaining === 0) {
    btn.disabled = false;
    btn.dataset.state = "done";
    btn.textContent = "完成";
    return;
  }
  btn.dataset.state = "upload";
  btn.disabled = !remaining || isFileMode();
  btn.textContent = remaining ? `确认上传 (${remaining})` : "确认上传";
}

const STATUS_TEXT = {
  ready: ["待上传", ""],
  uploading: ["上传中…", "uploading"],
  done: ["已上传", "done"],
  error: ["上传失败", "error"],
};

function renderUploadList() {
  $("#uploadList").innerHTML = pending.map((entry, index) => {
    const [text, className] = STATUS_TEXT[entry.status] || STATUS_TEXT.ready;
    const media = entry.kind === "photo"
      ? `<img src="${entry.url}" alt="" />`
      : `<video src="${entry.url}" muted playsinline preload="metadata"></video>`;
    return `<li class="upload-item">
      <span class="upload-thumb">${media}<span class="kind">${entry.kind === "photo" ? "照片" : "视频"}</span></span>
      <span class="upload-info">
        <b title="${esc(entry.file.name)}">${esc(entry.file.name)}</b>
        <span>${entry.kind === "photo" ? "照片" : "视频"} · ${formatSize(entry.file.size)}</span>
        <em class="status ${className}">${text}${entry.status === "error" && entry.error ? "：" + esc(entry.error) : ""}</em>
      </span>
      <button type="button" class="upload-remove" data-index="${index}" ${uploading ? "disabled" : ""}>移除</button>
    </li>`;
  }).join("");

  updateConfirmButton();
}

function addFiles(fileList) {
  const skipped = [];
  for (const file of fileList) {
    const kind = fileKind(file);
    if (!kind || file.size === 0) {
      skipped.push(file.name || "未知文件");
      continue;
    }
    pending.push({ file, kind, url: URL.createObjectURL(file), status: "ready", error: "" });
  }
  if (skipped.length) {
    showNote(`已跳过不支持的文件：${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? " 等" : ""}`, true);
  }
  renderUploadList();
}

function openUploader() {
  if (readOnly) return;
  uploader.classList.add("open");
  document.body.classList.add("no-scroll");
  hideNote();
  closeNewAlbum();
  updateAlbumOptions();
  if (isFileMode()) {
    showNote("当前是双击打开网页的模式，上传需要先运行 node server.js，再访问终端里显示的网址。", true);
  }
  $("#navLinks").classList.remove("open");
  $("#navToggle").setAttribute("aria-expanded", "false");
  $("#dropzone").focus();
  updateConfirmButton();
}

function closeUploader() {
  if (uploading) {
    showNote("正在上传，请稍候…", false);
    return;
  }
  uploader.classList.remove("open");
  document.body.classList.remove("no-scroll");
  pending.forEach((entry) => URL.revokeObjectURL(entry.url));
  pending = [];
  fileInput.value = "";
  $("#uploadList").innerHTML = "";
  $("#uploadConfirm").dataset.state = "";
  hideNote();
  closeNewAlbum();
  updateConfirmButton();
}

async function refreshData() {
  try {
    const res = await fetch("/api/media", { cache: "no-store" });
    if (res.ok) applyData(await res.json());
  } catch (err) {
    /* 刷新页面也能看到最新数据 */
  }
}

function setReadOnly(on) {
  readOnly = on;
  document.body.classList.toggle("read-only", on);
}

/* 有本地服务器 API 时可上传/删除；纯静态托管时自动变为只读 */
async function detectMode() {
  if (location.protocol === "file:") {
    setReadOnly(true);
    return;
  }
  try {
    const res = await fetch("/api/media", { cache: "no-store" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("application/json")) throw new Error("static");
    applyData(await res.json());
    setReadOnly(false);
  } catch (err) {
    setReadOnly(true);
  }
}

async function confirmUpload() {
  if (uploading || isFileMode()) return;
  const targets = pending.filter((entry) => entry.status !== "done");
  if (!targets.length) return;

  const album = $("#albumInput").value.trim() || "我的上传";
  uploading = true;
  hideNote();
  targets.forEach((entry) => {
    entry.status = "uploading";
    entry.error = "";
  });
  renderUploadList();

  let okCount = 0;
  let failCount = 0;

  for (const entry of targets) {
    try {
      const res = await fetch(
        `/api/upload?name=${encodeURIComponent(entry.file.name)}&album=${encodeURIComponent(album)}`,
        { method: "POST", body: entry.file }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `服务器返回 ${res.status}`);
      entry.status = "done";
      okCount += 1;
    } catch (err) {
      entry.status = "error";
      entry.error = err.message || "网络错误";
      failCount += 1;
    }
    renderUploadList();
  }

  uploading = false;

  if (okCount) {
    await refreshData();
    showNote(`已成功上传 ${okCount} 个文件，照片和视频已自动分类到对应区域。`, false);
  }
  if (failCount) {
    showNote(`有 ${failCount} 个文件上传失败，请检查网络或重试。`, true);
  }
  renderUploadList();
}

function bindUploader() {
  $("#uploadBtn").addEventListener("click", openUploader);
  $("#uploadClose").addEventListener("click", closeUploader);
  $("#uploadCancel").addEventListener("click", closeUploader);

  $("#uploadConfirm").addEventListener("click", () => {
    if ($("#uploadConfirm").dataset.state === "done") closeUploader();
    else confirmUpload();
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  $("#uploadList").addEventListener("click", (e) => {
    const btn = e.target.closest(".upload-remove");
    if (!btn || uploading) return;
    const index = Number(btn.dataset.index);
    const entry = pending[index];
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    pending.splice(index, 1);
    renderUploadList();
  });

  $("#newAlbumBtn").addEventListener("click", () => {
    if (newAlbumBox.hidden) openNewAlbum();
    else closeNewAlbum();
  });
  $("#newAlbumCreate").addEventListener("click", createAlbum);
  $("#newAlbumCancel").addEventListener("click", closeNewAlbum);
  $("#newAlbumName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      createAlbum();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNewAlbum();
    }
  });

  uploader.addEventListener("click", (e) => {
    if (e.target === uploader) closeUploader();
  });
}

/* ---------- 界面切换 ---------- */
const VIEWS = ["home", "albums", "gallery", "files", "about"];

function applyView() {
  const id = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";

  VIEWS.forEach((view) => {
    const section = document.getElementById(view);
    if (section) section.hidden = view !== id;
  });

  document.querySelectorAll('#navLinks a[href^="#"]').forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === "#" + id);
  });

  document.body.dataset.view = id;
  window.scrollTo(0, 0);
  observeReveals();
  if (id === "home") window.dispatchEvent(new Event("resize"));
}

/* ---------- 导航 ---------- */
function bindNav() {
  const toggle = $("#navToggle");
  const links = $("#navLinks");

  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  links.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* ---------- 滚动渐显 ---------- */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });

function observeReveals(root = document) {
  root.querySelectorAll(".reveal:not(.visible)").forEach((el) => revealObserver.observe(el));
}

/* ---------- 启动 ---------- */
rebuild();
applySite();
renderStats();
renderAlbums();
renderChips();
renderGallery();
renderCollage();
renderFiles();
updateAlbumOptions();
bindTypeFilter();
bindSearch();
bindLightbox();
bindUploader();
bindAlbumCreate();
bindNav();

document.querySelectorAll(".section-head, .about-grid").forEach((el) => el.classList.add("reveal"));
observeReveals();

initHeroCanvas();
initHeroParallax();

window.addEventListener("hashchange", applyView);
applyView();
detectMode();
