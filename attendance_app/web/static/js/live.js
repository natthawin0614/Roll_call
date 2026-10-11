// Live check-in: camera -> WebSocket -> boxes + names, real-time roster, teacher confirmation popup.

renderNav("home");
const SESSION_ID = Number(params.get("session"));
const video = $("#video");
const overlay = $("#overlay");
const ctx = overlay.getContext("2d");
const grab = document.createElement("canvas");

let session = null;
let roster = [];
let cameraCfg = { send_width: 960, jpeg_quality: 0.8 };
let stream = null;
let ws = null;
let waiting = false;
let running = false;
let lastFaces = [];
let frameTimes = [];
let filter = "all";
let verifyQueue = [];
let verifyOpen = false;
let highlight = new Set();

const STATUS = {
  success:        { color: "#57c08f", text: "เช็คชื่อสำเร็จ" },
  already:        { color: "#c9a96e", text: "เช็คชื่อแล้ว" },
  checking:       { color: "#7aa7dc", text: "กำลังยืนยัน" },
  ambiguous:      { color: "#e5ad48", text: "ไม่แน่ใจ" },
  unknown:        { color: "#98a3b6", text: "ไม่รู้จัก" },
  spoof:          { color: "#e46b6b", text: "สงสัยภาพปลอม" },
  adjust:         { color: "#98a3b6", text: "มองตรงที่กล้อง" },
  challenge:      { color: "#e5ad48", text: "ยืนยันว่าเป็นคนจริง" },
};

$("#ph-mark").innerHTML = ICONS.camera;
$("#live-pill").classList.add("hidden");

// ---------------------------------------------------------------- session + roster
async function loadSession() {
  session = await api(`/api/sessions/${SESSION_ID}`);
  if (session.closed_at) {
    toast("คาบนี้ปิดไปแล้ว", "warn");
    return setTimeout(() => location.href = `/section.html?id=${session.section_id}&tab=history`, 1200);
  }
  const sec = session.section;
  document.title = `Roll Call · เช็คชื่อ ${sec.course_name}`;
  $("#head").innerHTML = `
    <div class="row" style="gap:16px">
      <a class="icon-btn" href="/section.html?id=${session.section_id}" title="กลับ">${ICONS.back}</a>
      <div><div class="eyebrow" style="margin:0">${esc(sec.course_code || "")} · SEC ${esc(sec.section || "-")} · ${session.date}</div>
        <h2>${esc(sec.course_name)}</h2></div>
    </div>
    <div class="row">
      <button class="btn ghost" id="time-btn">${ICONS.clock} เริ่ม ${session.start} น. · สายหลัง ${session.late_minutes} นาที</button>
      <button class="btn danger" id="close-btn">ปิดคาบ</button>
    </div>`;
  $("#time-btn").onclick = timeDialog;
  $("#close-btn").onclick = closeSession;
  setRoster(session.roster, session.summary);
  loadEvidenceCount();
}

function setRoster(rows, summary) {
  const firstLoad = roster.length === 0;
  const before = new Set(roster.filter((r) => r.status !== "absent").map((r) => r.student_id));
  roster = rows;
  if (!firstLoad) rows.forEach((r) => { if (r.status !== "absent" && !before.has(r.student_id)) highlight.add(r.student_id); });
  $("#c-present").textContent = summary.present;
  $("#c-late").textContent = summary.late;
  $("#c-absent").textContent = summary.absent;
  renderRoster();
  setTimeout(() => { highlight.clear(); }, 2500);
}

async function refreshRoster() {
  const s = await api(`/api/sessions/${SESSION_ID}`);
  setRoster(s.roster, s.summary);
}

function renderRoster() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = roster.filter((r) =>
    (filter === "all" || (filter === "in") === (r.status !== "absent")) &&
    (!q || r.name.toLowerCase().includes(q) || (r.code || "").includes(q)));
  rows.sort((a, b) => (a.status === "absent") - (b.status === "absent") || (b.checked_at || "").localeCompare(a.checked_at || ""));
  $("#roster").innerHTML = rows.map((r) => `
    <div class="roster-item ${highlight.has(r.student_id) ? "new" : ""}">
      ${r.snapshot || r.photo ? `<img class="avatar" src="${r.snapshot || r.photo}" alt="">` : `<div class="avatar"></div>`}
      <div class="who">
        <div><b>${esc(r.name)}</b> ${r.risk ? `<span class="gold" title="กลุ่มเสี่ยง">${"●"}</span>` : ""}</div>
        <div class="small muted">${r.status === "absent" ? esc(r.code || "ยังไม่เช็คชื่อ")
          : `${r.checked_at} · ${esc(r.method_th)}${r.similarity ? ` · ${r.similarity}` : ""}`}</div>
      </div>
      ${r.status === "absent"
        ? `<button class="btn sm" data-add="${r.student_id}" title="เช็คชื่อด้วยตนเอง">${ICONS.check}</button>`
        : `<span class="badge ${r.status === "late" ? "warn" : "ok"}">${r.status_th}</span>
           <button class="btn ghost sm" data-remove="${r.student_id}" title="ยกเลิก">${ICONS.x}</button>`}
    </div>`).join("") || `<p class="muted center small">ไม่มีรายชื่อ</p>`;
  $$("[data-add]").forEach((b) => b.onclick = () => manual(b.dataset.add, "add"));
  $$("[data-remove]").forEach((b) => b.onclick = () => manual(b.dataset.remove, "remove"));
}

async function manual(studentId, action) {
  const r = roster.find((x) => x.student_id == studentId);
  if (action === "remove" && !(await confirmBox(`ยกเลิกการเช็คชื่อของ ${r.name}?`, "รายการนี้จะถูกลบและบันทึกว่าอาจารย์ยกเลิกเอง", { ok: "ยกเลิกรายการ", danger: true }))) return;
  const s = await api(`/api/sessions/${SESSION_ID}/manual`, { method: "POST", json: { student_id: Number(studentId), action } });
  toast(action === "add" ? `เช็คชื่อ ${r.name} แล้ว (อาจารย์เช็คเอง)` : `ยกเลิกการเช็คชื่อของ ${r.name} แล้ว`);
  setRoster(s.roster, s.summary);
}

$$("#rtabs button").forEach((b) => b.onclick = () => {
  filter = b.dataset.f;
  $$("#rtabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderRoster();
});
$("#search").addEventListener("input", renderRoster);

// ---------------------------------------------------------------- clock / late countdown
function tick() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (!session) return;
  const start = new Date(session.scheduled_start.replace(" ", "T"));
  const deadline = new Date(start.getTime() + session.late_minutes * 60000);
  $("#late-info").textContent = `เริ่ม ${session.start} น.`;
  const left = Math.round((deadline - now) / 60000);
  $("#late-left").textContent = left > 0 ? `อีก ${left} นาทีนับว่าสาย` : "ตอนนี้เช็คชื่อ = สาย";
  $("#late-left").style.color = left > 0 ? "var(--gold)" : "var(--warn)";
}
setInterval(tick, 1000);

function timeDialog() {
  const m = openModal(`<div class="modal-head"><h3>เวลาเริ่มคาบและเกณฑ์สาย</h3><button class="icon-btn" data-close>${ICONS.x}</button></div>
    <div class="form-grid"><label class="field">เวลาเริ่มคาบ<input class="input" type="time" id="st" value="${session.start}"></label>
    <label class="field">สายเมื่อเกิน (นาที)<input class="input" type="number" id="lm" min="0" value="${session.late_minutes}"></label></div>
    <p class="small muted">สถานะ มา/สาย ของทุกคนจะคำนวณใหม่ตามเวลานี้</p>
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="ok">บันทึก</button></div>`);
  $("#ok", m.el).onclick = async () => {
    session = await api(`/api/sessions/${SESSION_ID}`, { method: "PUT", json: { start: $("#st", m.el).value, late_minutes: Number($("#lm", m.el).value) } });
    m.close(); loadSession(); toast("บันทึกเวลาแล้ว");
  };
}

// ---------------------------------------------------------------- camera
async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const saved = (() => { try { return localStorage.getItem("camera"); } catch (_) { return null; } })();
  $("#camera").innerHTML = devices.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === saved ? "selected" : ""}>${esc(d.label || `กล้อง ${i + 1}`)}</option>`).join("")
    || `<option value="">กล้องเริ่มต้น</option>`;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return toast("เบราว์เซอร์ไม่อนุญาตกล้อง: ต้องเปิดผ่าน http://localhost หรือ https:// (ดู README)", "bad", 7000);
  }
  stopCamera();
  const deviceId = $("#camera").value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    return toast("เปิดกล้องไม่ได้: " + e.message, "bad", 6000);
  }
  video.srcObject = stream;
  await video.play();
  try { localStorage.setItem("camera", deviceId); } catch (_) {}
  await listCameras();
  $("#placeholder").classList.add("hidden");
  $("#live-pill").classList.remove("hidden");
  $("#cam-btn").innerHTML = `${ICONS.x} ปิดกล้อง`;
  running = true;
  connect();
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  $("#placeholder").classList.remove("hidden");
  $("#live-pill").classList.add("hidden");
  $("#cam-btn").innerHTML = `${ICONS.camera} เปิดกล้อง`;
}

$("#cam-btn").onclick = () => running ? stopCamera() : startCamera();
$("#camera").onchange = () => { if (running) startCamera(); };
$("#mirror").onchange = () => { $("#stage").classList.toggle("mirror", $("#mirror").checked); drawFaces(lastFaces); };

// ---------------------------------------------------------------- websocket loop
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/live/${SESSION_ID}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { waiting = false; sendFrame(); };
  ws.onmessage = (msg) => handleMessage(JSON.parse(msg.data));
  ws.onclose = () => { if (running) setTimeout(connect, 1500); };
}

function sendFrame() {
  if (!running || !ws || ws.readyState !== 1 || waiting || !video.videoWidth) {
    if (running) setTimeout(sendFrame, 30);
    return;
  }
  const scale = Math.min(1, cameraCfg.send_width / video.videoWidth);
  grab.width = Math.round(video.videoWidth * scale);
  grab.height = Math.round(video.videoHeight * scale);
  grab.getContext("2d").drawImage(video, 0, 0, grab.width, grab.height);
  waiting = true;
  grab.toBlob((blob) => blob.arrayBuffer().then((buf) => { if (ws && ws.readyState === 1) ws.send(buf); else waiting = false; }),
    "image/jpeg", cameraCfg.jpeg_quality);
}

function handleMessage(data) {
  if (data.type === "closed") { stopCamera(); toast("คาบนี้ถูกปิดแล้ว", "warn"); return; }
  if (data.type === "verified") { if (data.roster_changed) refreshRoster(); return; }
  if (data.type === "error") { toast(data.message, "bad"); }
  if (data.type === "result") {
    lastFaces = data.faces;
    drawFaces(data.faces);
    data.events.forEach(handleEvent);
    if (data.roster_changed) refreshRoster();
    const now = performance.now();
    frameTimes = frameTimes.filter((t) => now - t < 2000).concat(now);
    $("#fps").textContent = (frameTimes.length / 2).toFixed(1);
  }
  waiting = false;
  setTimeout(sendFrame, 0);        // setTimeout keeps running when the tab is in the background
}

// ---------------------------------------------------------------- drawing
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawFaces(faces) {
  if (!video.videoWidth) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const k = video.videoWidth / grab.width;
  const mirror = $("#mirror").checked;
  const unit = overlay.width / 960;
  faces.forEach((f) => {
    let [x1, y1, x2, y2] = f.box.map((v) => v * k);
    if (mirror) [x1, x2] = [overlay.width - x2, overlay.width - x1];
    const w = x2 - x1, h = y2 - y1;
    const st = STATUS[f.status] || STATUS.unknown;
    // phone / screen / print found around the face
    if (f.device_box) {
      let [d1, e1, d2, e2] = f.device_box.map((v) => v * k);
      if (mirror) [d1, d2] = [overlay.width - d2, overlay.width - d1];
      ctx.save(); ctx.setLineDash([10 * unit, 6 * unit]); ctx.strokeStyle = STATUS.spoof.color; ctx.lineWidth = 3 * unit;
      ctx.strokeRect(d1, e1, d2 - d1, e2 - e1); ctx.restore();
      ctx.fillStyle = STATUS.spoof.color; ctx.font = `600 ${14 * unit}px Prompt, sans-serif`;
      ctx.fillText("มือถือ / จอ / รูปพิมพ์", d1 + 6 * unit, e2 - 8 * unit);
    }
    if (f.status === "challenge") drawChallenge(f.challenge, x1, y1, w, h, unit, mirror);
    // corner brackets
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 3.2 * unit;
    ctx.lineCap = "round";
    const c = Math.min(w, h) * 0.22;
    [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + dy * c); ctx.lineTo(x, y); ctx.lineTo(x + dx * c, y); ctx.stroke();
    });
    ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2 * unit; ctx.strokeRect(x1, y1, w, h); ctx.globalAlpha = 1;
    // progress arc while confirming
    if (f.status === "checking" && f.progress > 0) {
      ctx.beginPath(); ctx.lineWidth = 4 * unit; ctx.strokeStyle = st.color;
      ctx.arc(x1 + w / 2, y2 + 16 * unit, 9 * unit, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f.progress); ctx.stroke();
    }
    // label
    let title = f.status === "unknown" ? "ไม่รู้จัก" : (f.name || st.text);
    let sub = f.status === "unknown" ? "" : st.text + (f.similarity ? `  ${f.similarity.toFixed(2)}` : "");
    if (f.status === "adjust") { title = f.hint || st.text; sub = ""; }
    if (f.status === "spoof" && f.reason) sub = f.reason;
    if (f.status === "challenge") { title = `หัน${f.challenge.dir === "left" ? "ซ้าย" : "ขวา"} แล้วหันกลับ`; sub = `เหลือ ${f.challenge.remaining.toFixed(0)} วินาที`; }
    ctx.font = `600 ${18 * unit}px Prompt, sans-serif`;
    const tw = Math.max(ctx.measureText(title).width, (ctx.font = `400 ${13 * unit}px Prompt, sans-serif`, ctx.measureText(sub).width));
    const bw = tw + 26 * unit, bh = (sub ? 50 : 32) * unit;
    const bx = Math.min(Math.max(x1, 4), overlay.width - bw - 4), by = Math.max(4, y1 - bh - 8 * unit);
    ctx.fillStyle = "rgba(8,13,24,.78)"; roundRect(bx, by, bw, bh, 10 * unit); ctx.fill();
    ctx.fillStyle = st.color; roundRect(bx, by, 5 * unit, bh, 3 * unit); ctx.fill();
    ctx.fillStyle = "#f3ecdd"; ctx.font = `600 ${18 * unit}px Prompt, sans-serif`;
    ctx.fillText(title, bx + 15 * unit, by + 23 * unit);
    if (sub) { ctx.fillStyle = st.color; ctx.font = `400 ${13 * unit}px Prompt, sans-serif`; ctx.fillText(sub, bx + 15 * unit, by + 41 * unit); }
  });
}

// Head-turn challenge: big arrow beside the face (in screen space: the student's own left is on the
// left of a mirrored view), filling up as the head turns; then "back to the camera".
function drawChallenge(c, x1, y1, w, h, unit, mirror) {
  const screenLeft = (c.dir === "left") === mirror;
  const cy = y1 + h / 2, size = Math.max(36 * unit, h * 0.45);
  const cx = screenLeft ? x1 - size * 0.9 : x1 + w + size * 0.9;
  const dir = screenLeft ? -1 : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(dir * size * 0.6, 0); ctx.lineTo(dir * -size * 0.1, -size * 0.5); ctx.lineTo(dir * -size * 0.1, -size * 0.2);
  ctx.lineTo(dir * -size * 0.6, -size * 0.2); ctx.lineTo(dir * -size * 0.6, size * 0.2); ctx.lineTo(dir * -size * 0.1, size * 0.2);
  ctx.lineTo(dir * -size * 0.1, size * 0.5); ctx.closePath();
  ctx.fillStyle = "rgba(8,13,24,.55)"; ctx.fill();
  ctx.lineWidth = 3 * unit; ctx.strokeStyle = STATUS.challenge.color; ctx.stroke();
  ctx.clip();
  const p = c.turned ? 1 : c.progress;              // fill from the tail towards the tip
  const from = dir * -size * 0.6, span = dir * size * 1.2 * p;
  ctx.fillStyle = c.turned ? STATUS.success.color : STATUS.challenge.color;
  ctx.fillRect(Math.min(from, from + span), -size, Math.abs(span), size * 2);
  ctx.restore();
  if (c.turned) {
    ctx.fillStyle = STATUS.success.color; ctx.font = `600 ${15 * unit}px Prompt, sans-serif`;
    ctx.fillText("ดีมาก หันกลับมามองกล้อง", x1, y1 + h + 22 * unit);
  }
}

// ---------------------------------------------------------------- events: feed, chime, popup
function feed(text, color) {
  const el = document.createElement("span");
  el.className = "pill";
  el.style.borderColor = color;
  el.innerHTML = text;
  $("#feed").prepend(el);
  while ($("#feed").children.length > 4) $("#feed").lastChild.remove();
  setTimeout(() => { el.style.transition = "opacity .6s"; el.style.opacity = 0; setTimeout(() => el.remove(), 600); }, 6000);
}

let audio = null;
function chime(ok = true) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = "sine";
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.35 : 0.6));
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.7);
  } catch (_) {}
}

function handleEvent(e) {
  if (e.kind === "checked") {
    feed(`<span style="color:#57c08f">${ICONS.check}</span> ${esc(e.name)} เช็คชื่อแล้ว ${e.late ? '<span style="color:#e5ad48">(สาย)</span>' : ""}`, "#57c08f");
    chime(true);
  } else if (e.kind === "spoof") {
    feed(`<span style="color:#e46b6b">${ICONS.shield}</span> ตรวจพบภาพปลอม${e.name ? " (คล้าย " + esc(e.name) + ")" : ""} — ไม่เช็คชื่อ${e.reason ? `<br><span class="small muted">${esc(e.reason)}</span>` : ""}`, "#e46b6b");
    chime(false);
    loadEvidenceCount();
  } else if (e.kind === "verify") {
    verifyQueue.push(e);
    showNextVerify();
  }
}

function showNextVerify() {
  if (verifyOpen || !verifyQueue.length) return;
  const v = verifyQueue.shift();
  verifyOpen = true;
  let answered = false;
  const anyRisk = v.candidates.some((c) => c.risk);
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">ยืนยันตัวตน</div><h2>นี่คือใคร?</h2>
      <p class="muted small" style="margin:4px 0 0">ระบบไม่มั่นใจพอที่จะเช็คชื่ออัตโนมัติ (แฝด/หน้าคล้าย) กรุณาเลือกคนที่ถูกต้อง</p></div></div>
    <div class="verify-grid">
      <div class="verify-live"><img src="${v.live}" alt=""><div class="small muted center" style="margin-top:6px">ภาพจากกล้องตอนนี้</div></div>
      <div class="stack">${v.candidates.map((c) => `
        <div class="cand" data-pick="${c.student_id}">
          <div class="imgs">${c.photos.map((u) => `<img src="${u}" alt="">`).join("")}</div>
          <div class="grow"><b>${esc(c.name)}</b> ${c.risk ? `<span class="badge gold">${ICONS.twin} กลุ่มเสี่ยง</span>` : ""}
            <div class="small muted">${esc(c.code || "")} · similarity ${c.similarity}${c.already ? ' · <span style="color:var(--warn)">เช็คชื่อไปแล้ว</span>' : ""}</div></div>
          <span class="btn gold sm">เลือก</span>
        </div>`).join("")}
        <label class="check small"><input type="checkbox" id="addref" ${anyRisk ? "checked" : ""}>
          <span>เพิ่มภาพนี้เป็นรูปอ้างอิงของคนที่เลือก (ช่วยให้แยกแฝด/หน้าคล้ายได้แม่นขึ้นครั้งต่อไป)</span></label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn danger" id="none">ไม่ใช่ทุกคน / ไม่เช็คชื่อ</button><button class="btn ghost" id="later">ข้าม</button></div>`,
    { wide: true, onClose: () => { verifyOpen = false; showNextVerify(); } });
  const send = (studentId) => {
    if (answered) return;
    answered = true;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "verify", request_id: v.request_id, student_id: studentId, add_reference: $("#addref", m.el).checked }));
    if (studentId) { const c = v.candidates.find((x) => x.student_id === studentId); feed(`${ICONS.check} อาจารย์ยืนยัน: ${esc(c.name)}`, "#c9a96e"); }
    m.close();
  };
  $$("[data-pick]", m.el).forEach((el) => el.onclick = () => send(Number(el.dataset.pick)));
  $("#none", m.el).onclick = () => send(null);
  $("#later", m.el).onclick = () => m.close();
}

// ---------------------------------------------------------------- spoof evidence
async function loadEvidenceCount() {
  const events = await api(`/api/sessions/${SESSION_ID}/events`);
  const n = events.filter((e) => e.kind === "spoof").length;
  $("#evidence-btn").innerHTML = `${ICONS.shield} หลักฐานสงสัยปลอม ${n ? `<span class="badge bad">${n}</span>` : ""}`;
  $("#evidence-btn").onclick = () => showEvidence(events);
}

function showEvidence(events) {
  const list = events.filter((e) => ["spoof", "confirm", "reject"].includes(e.kind));
  const m = openModal(`<div class="modal-head"><div><div class="eyebrow">หลักฐาน</div><h2>สงสัยปลอม & การยืนยันตัวตน</h2>
      <p class="muted small" style="margin:4px 0 0">กดตรวจว่าเป็นภาพปลอมจริงหรือคนจริง ข้อมูลนี้ใช้ปรับปรุงโมเดล anti-spoof ได้ (หน้าตั้งค่า → ส่งออกข้อมูล)</p></div>
      <button class="icon-btn" data-close>${ICONS.x}</button></div>
    ${list.length ? `<div class="evidence">${list.map((e) => `<figure>
      ${e.image ? `<a href="${e.full || e.image}" target="_blank"><img src="${e.image}" alt=""></a>` : ""}
      <figcaption><span class="badge ${e.kind === "spoof" ? "bad" : e.kind === "confirm" ? "ok" : "line"}">${esc(e.kind_th)}</span>
        <span>${e.at}${e.student ? " · " + esc(e.student) : ""}</span>
        ${e.detail && e.detail.reason_th ? `<span class="small muted">${esc(e.detail.reason_th)}</span>` : ""}
        ${e.kind === "spoof" ? (e.reviewed ? `<span class="small muted">ตรวจแล้ว: ${e.reviewed === "live" ? "คนจริง" : "ปลอมจริง"}</span>`
          : `<span class="row" style="gap:4px"><button class="btn sm ok" data-review="${e.id}" data-v="spoof">ปลอมจริง</button><button class="btn sm" data-review="${e.id}" data-v="live">คนจริง</button></span>`) : ""}
      </figcaption></figure>`).join("")}</div>` : '<p class="muted">ยังไม่มีเหตุการณ์</p>'}`, { wide: true });
  $$("[data-review]", m.el).forEach((b) => b.onclick = async () => {
    await api(`/api/events/${b.dataset.review}/review`, { method: "POST", json: { verdict: b.dataset.v } });
    m.close();
    loadEvidenceCount().then(() => $("#evidence-btn").click());
  });
}

// ---------------------------------------------------------------- close session
async function closeSession() {
  const s = await api(`/api/sessions/${SESSION_ID}`);
  if (!(await confirmBox("ปิดคาบนี้?", `มา ${s.summary.present} · สาย ${s.summary.late} · ขาด ${s.summary.absent} คน<br>ปิดแล้วจะสรุปผลเป็นไฟล์ Excel (แก้ไขภายหลังไม่ได้จากหน้านี้)`, { ok: "ปิดคาบและสรุปผล" }))) return;
  stopCamera();
  const r = await api(`/api/sessions/${SESSION_ID}/close`, { method: "POST" });
  openModal(`<div class="center stack" style="align-items:center">
      <div class="brand-mark" style="width:64px;height:64px;border-radius:20px">${ICONS.check}</div>
      <div class="eyebrow">ปิดคาบเรียบร้อย</div><h2>${esc(r.section.course_name)}</h2>
      <p class="muted" style="margin:0">${r.date} · เริ่ม ${r.start} น. · ปิด ${r.closed_at} น.</p>
      <div class="counts" style="width:100%;margin:10px 0">
        <div class="count ok"><b>${r.summary.present}</b><span>มา</span></div><div class="count warn"><b>${r.summary.late}</b><span>สาย</span></div>
        <div class="count bad"><b>${r.summary.absent}</b><span>ขาด</span></div></div>
      <a class="btn gold lg" href="${r.excel}">${ICONS.download} ดาวน์โหลด Excel</a>
      <a class="btn ghost" href="/section.html?id=${r.section_id}&tab=history">ไปหน้าประวัติคาบ</a></div>`,
    { onClose: () => location.href = `/section.html?id=${r.section_id}&tab=history` });
}

// ---------------------------------------------------------------- start
(async () => {
  $("#cam-btn").innerHTML = `${ICONS.camera} เปิดกล้อง`;
  await loadSession();
  try {
    const s = await api("/api/settings");
    cameraCfg = s.camera;
    $("#device-pill").textContent = `ประมวลผลด้วย ${s.device}`;
  } catch (_) {}
  try { await listCameras(); } catch (_) {}
  if (params.get("autostart")) startCamera();      // live.html?session=1&autostart=1 (kiosk / testing)
})();
window.addEventListener("resize", () => drawFaces(lastFaces));
