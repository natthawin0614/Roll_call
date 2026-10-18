// Shared helpers: API calls, nav bar, theme, toasts, modals.

const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17a5 5 0 0 1 9 0"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  twin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0M10.5 19a5.5 5.5 0 0 1 11 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const params = new URLSearchParams(location.search);

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.json !== undefined) {
    opts.body = JSON.stringify(opts.json);
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    delete opts.json;
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    let message = `เกิดข้อผิดพลาด (${res.status})`;
    try { const body = await res.json(); if (body.detail) message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail); } catch (_) {}
    toast(message, "bad");
    throw new Error(message);
  }
  const type = res.headers.get("content-type") || "";
  return type.includes("application/json") ? res.json() : res;
}

// ---------------------------------------------------------------- theme
function getTheme() {
  const forced = new URLSearchParams(location.search).get("theme");   // e.g. ?theme=light
  if (forced) return forced;
  try { return localStorage.getItem("theme") || "dark"; } catch (_) { return "dark"; }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $("#theme-btn");
  if (btn) btn.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
}
function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem("theme", next); } catch (_) {}
  applyTheme(next);
}
applyTheme(getTheme());

// ---------------------------------------------------------------- nav
function renderNav(active) {
  const nav = document.createElement("header");
  nav.className = "nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="brand" href="/">
        <span class="brand-mark">${ICONS.logo}</span>
        <span class="brand-name">Roll <em>Call</em></span>
      </a>
      <nav class="nav-links">
        <a href="/" class="${active === "home" ? "active" : ""}">ห้องเรียน</a>
        <a href="/settings.html" class="${active === "settings" ? "active" : ""}">ตั้งค่า</a>
        <button class="icon-btn" id="theme-btn" title="สลับโหมดสว่าง/มืด"></button>
      </nav>
    </div>`;
  document.body.prepend(nav);
  $("#theme-btn").addEventListener("click", toggleTheme);
  applyTheme(getTheme());
}

// ---------------------------------------------------------------- toasts
function toast(message, kind = "ok", ms = 3800) {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.append(box); }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = esc(message);
  box.append(el);
  setTimeout(() => { el.style.transition = "opacity .4s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, ms);
}

// ---------------------------------------------------------------- modals
function openModal(html, { wide = false, onClose, beforeClose } = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  const close = () => { back.remove(); onClose && onClose(); };
  // closing by the user (✕ / Cancel / backdrop) can be stopped, e.g. "discard unsaved photos?"
  const userClose = async () => { if (!beforeClose || (await beforeClose())) close(); };
  back.addEventListener("mousedown", (e) => { if (e.target === back) userClose(); });
  $$("[data-close]", back).forEach((b) => b.addEventListener("click", userClose));
  document.body.append(back);
  return { el: back, close };
}

function confirmBox(title, text, { ok = "ยืนยัน", danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <p class="muted">${text}</p>
      <div class="modal-foot">
        <button class="btn ghost" data-close>ยกเลิก</button>
        <button class="btn ${danger ? "danger" : "gold"}" id="cb-ok">${esc(ok)}</button>
      </div>`, { onClose: () => resolve(false) });
    $("#cb-ok", m.el).addEventListener("click", () => { m.el.remove(); resolve(true); });
  });
}

// PDPA consent text, shown before any face photo is added
const CONSENT_TEXT = `ภาพใบหน้าและข้อมูลชีวมิติ (face embedding) จะถูกใช้เพื่อการเช็คชื่อในรายวิชานี้เท่านั้น
  เก็บไว้ในเครื่องนี้ ไม่ส่งออกอินเทอร์เน็ต และลบได้ทุกเมื่อ ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA)`;
function consentBlock(id = "consent") {
  return `<label class="check" style="margin-top:6px"><input type="checkbox" id="${id}">
    <span>ข้าพเจ้ายืนยันว่าได้แจ้งและ<b>ได้รับความยินยอม</b>จากนักศึกษาแล้ว<br><span class="muted small">${CONSENT_TEXT}</span></span></label>`;
}

function wireDropzone(zone, input, onFiles) {
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files.length) onFiles([...input.files]); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
  zone.addEventListener("drop", (e) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) onFiles(files);
  });
}

function sectionTitle(s) {
  return `${s.course_code ? s.course_code + " · " : ""}${s.course_name}`;
}

// ---------------------------------------------------------------- shared dialogs
function sectionForm(s = null, onSaved = null) {
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">${s ? "แก้ไข" : "ใหม่"}</div><h2>${s ? "แก้ไขห้องเรียน" : "สร้างห้องเรียน"}</h2></div>
      <button class="icon-btn" data-close>${ICONS.x}</button></div>
    <form class="form-grid" id="f">
      <label class="field">รหัสวิชา<input class="input" name="course_code" value="${esc(s?.course_code || "")}" placeholder="เช่น CS101"></label>
      <label class="field">Section<input class="input" name="section" value="${esc(s?.section || "")}" placeholder="เช่น 1"></label>
      <label class="field full">ชื่อวิชา *<input class="input" name="course_name" required value="${esc(s?.course_name || "")}" placeholder="เช่น Python for IoT"></label>
      <label class="field">เทอม<input class="input" name="term" value="${esc(s?.term || "")}" placeholder="เช่น 1/2569"></label>
      <label class="field">เวลาเริ่มคาบปกติ<input class="input" type="time" name="start_time" value="${esc(s?.start_time || "09:00")}"></label>
      <label class="field">มาสายเมื่อเกิน (นาที)<input class="input" type="number" min="0" name="late_minutes" value="${s?.late_minutes ?? 15}"></label>
    </form>
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="save">บันทึก</button></div>`);
  $("#save", m.el).addEventListener("click", async () => {
    const form = $("#f", m.el);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    data.late_minutes = Number(data.late_minutes);
    const saved = await api(s ? `/api/sections/${s.id}` : "/api/sections", { method: s ? "PUT" : "POST", json: data });
    m.close();
    toast("บันทึกห้องเรียนแล้ว");
    if (!s) location.href = `/section.html?id=${saved.id}`; else if (onSaved) onSaved(saved);
  });
}


function startSessionDialog(s) {
  const now = new Date();
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">เริ่มคาบ</div><h2>${esc(sectionTitle(s))}</h2>
      <p class="muted small" style="margin:4px 0 0">Section ${esc(s.section || "-")} · ${s.students} คน</p></div>
      <button class="icon-btn" data-close>${ICONS.x}</button></div>
    <div class="form-grid">
      <label class="field">เวลาเริ่มคาบวันนี้<input class="input" type="time" id="st" value="${esc(s.start_time)}"></label>
      <label class="field">มาสายเมื่อเกิน (นาที)<input class="input" type="number" min="0" id="lm" value="${s.late_minutes}"></label>
    </div>
    <p class="muted small">วันที่ ${now.toLocaleDateString("th-TH", { dateStyle: "long" })} · เช็คชื่อหลังเวลาเริ่ม + ${s.late_minutes} นาที จะนับเป็น "สาย"</p>
    ${s.students === 0 ? `<p class="badge warn">ห้องนี้ยังไม่มีนักศึกษา</p>` : ""}
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button>
      <button class="btn gold" id="go">${ICONS.camera} เริ่มคาบและเปิดกล้อง</button></div>`);
  $("#go", m.el).addEventListener("click", async () => {
    const session = await api(`/api/sections/${s.id}/sessions`, { method: "POST",
      json: { start: $("#st", m.el).value, late_minutes: Number($("#lm", m.el).value) } });
    location.href = `/live.html?session=${session.id}`;
  });
}
