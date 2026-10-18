// Class page: students + photos, folder import, look-alike check, session history.

renderNav("home");
const SECTION_ID = Number(params.get("id"));
let section = null;
let students = [];
let consentGiven = false;
$("#back").innerHTML = `${ICONS.back} ห้องเรียนทั้งหมด`;

// ---------------------------------------------------------------- header
async function loadSection() {
  section = await api(`/api/sections/${SECTION_ID}`);
  document.title = `Roll Call · ${section.course_name}`;
  $("#head").innerHTML = `
    <div>
      <div class="eyebrow">${esc(section.course_code || "COURSE")} · SECTION ${esc(section.section || "-")} · เทอม ${esc(section.term || "-")}</div>
      <h1>${esc(section.course_name)}</h1>
      <div class="class-meta" style="margin-top:10px">
        <span>${section.students} นักศึกษา</span><span>${section.photos} รูปอ้างอิง</span>
        <span>เริ่มคาบ ${esc(section.start_time)} น. · สายหลัง ${section.late_minutes} นาที</span>
        ${section.risk ? `<span class="gold">${section.risk} คนในกลุ่มเสี่ยง</span>` : ""}
      </div>
    </div>
    <div class="row">
      <button class="btn ghost" id="edit-sec">${ICONS.edit} แก้ไข</button>
      <button class="btn danger" id="del-sec">${ICONS.trash} ลบห้อง</button>
      <button class="btn gold lg" id="start">${ICONS.camera} ${section.open_session ? "กลับไปเช็คต่อ" : "เริ่มคาบ"}</button>
    </div>`;
  $("#edit-sec").onclick = () => sectionForm(section, () => loadSection());
  $("#del-sec").onclick = async () => {
    if (await confirmBox("ลบห้องเรียนนี้?", "นักศึกษา รูปใบหน้า และประวัติการเช็คชื่อทั้งหมดของห้องนี้จะถูกลบถาวร", { ok: "ลบถาวร", danger: true })) {
      await api(`/api/sections/${SECTION_ID}`, { method: "DELETE" });
      location.href = "/";
    }
  };
  $("#start").onclick = () => section.open_session ? location.href = `/live.html?session=${section.open_session}` : startSessionDialog(section);
}

// ---------------------------------------------------------------- tabs
let currentTab = "students";
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(tab) {
  currentTab = tab;
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["students", "similar", "history"].forEach((t) => $(`#tab-${t}`).classList.toggle("hidden", t !== tab));
  $("#tools").classList.toggle("hidden", tab !== "students");
  if (tab === "students") loadStudents();
  if (tab === "similar") loadSimilarity();
  if (tab === "history") loadHistory();
}

$("#tools").innerHTML = `
  <button class="btn" id="import-btn">${ICONS.folder} นำเข้าหลายคน</button>
  <button class="btn gold" id="add-btn">${ICONS.plus} เพิ่มนักศึกษา</button>`;
$("#import-btn").onclick = multiDialog;
$("#add-btn").onclick = () => studentDialog(null);

// ---------------------------------------------------------------- students
async function loadStudents() {
  students = await api(`/api/sections/${SECTION_ID}/students`);
  const box = $("#tab-students");
  if (!students.length) {
    box.innerHTML = `<div class="empty"><h3 style="margin-bottom:8px">ยังไม่มีนักศึกษา</h3>
      <p>นำเข้ารูปจากโฟลเดอร์ (ชื่อไฟล์ = ชื่อนักศึกษา) หรือเพิ่มทีละคน แนะนำ 3–5 รูปต่อคน ต่างมุม ต่างแสง</p>
      <div class="row" style="justify-content:center"><button class="btn gold" onclick="multiDialog()">${ICONS.folder} นำเข้าหลายคน</button>
      <button class="btn" onclick="studentDialog(null)">${ICONS.plus} เพิ่มทีละคน</button></div></div>`;
    return;
  }
  box.innerHTML = `<p class="muted small" style="margin-top:0">ลากรูปมาวางบนการ์ดนักศึกษาเพื่อเพิ่มรูปได้เลย · จุดสีส้ม = รูปที่ควรเปลี่ยน (เบลอ/หน้าเล็ก/หันข้าง)</p>
    <div class="grid cols-4">${students.map(studentCard).join("")}</div>`;
  $$(".student-card", box).forEach((card) => {
    const st = students.find((s) => s.id == card.dataset.id);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      studentDialog(st);
    });
    ["dragenter", "dragover"].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); card.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); card.classList.remove("drag"); }));
    card.addEventListener("drop", (e) => {
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) studentDialog(st, files);
    });
  });
  $$(".thumb .x", box).forEach((x) => x.addEventListener("click", (e) => { e.stopPropagation(); deletePhoto(x.dataset.photo); }));
}

function studentCard(st) {
  const target = st.risk_group ? 8 : 3;
  return `
    <article class="card hover student-card fade-in" data-id="${st.id}">
      <div class="row between">
        <div style="min-width:0">
          <div class="name">${esc(st.name)}</div>
          <div class="muted small">${esc(st.student_code || "ยังไม่มีรหัส")}</div>
        </div>
        ${st.risk_group ? `<span class="badge gold" title="แฝด/หน้าคล้าย: ใช้เกณฑ์เข้มขึ้น">${ICONS.twin} กลุ่มเสี่ยง</span>` : ""}
      </div>
      <div class="photos">
        ${st.photos.map((p) => `<div class="thumb ${p.warnings.length ? "warn" : ""}" title="${esc(p.warnings.join(" · ") || "รูปดี")}">
          <img src="${p.url}" loading="lazy" alt="">${p.warnings.length ? '<span class="dot"></span>' : ""}
          <button class="x" data-photo="${p.id}" title="ลบรูป">✕</button></div>`).join("")}
        ${st.photos.length < 10 ? `<div class="thumb add" title="เพิ่มรูป">+</div>` : ""}
      </div>
      <div class="row" style="gap:6px">
        <span class="badge ${st.photos.length >= target ? "ok" : st.photos.length ? "warn" : "bad"}">${st.photos.length}/${target}+ รูป</span>
        ${st.lookalikes.map((l) => `<span class="badge warn" title="similarity ${l.similarity}">คล้าย ${esc(l.name)} ${l.similarity}</span>`).join("")}
      </div>
    </article>`;
}

async function deletePhoto(id) {
  if (!(await confirmBox("ลบรูปนี้?", "รูปและ embedding ของรูปนี้จะถูกลบถาวร", { ok: "ลบ", danger: true }))) return;
  await api(`/api/photos/${id}`, { method: "DELETE" });
  toast("ลบรูปแล้ว");
  loadStudents();
  loadSection();
}

// ---------------------------------------------------------------- upload helpers
const IMG_EXT = /\.(jpe?g|png|webp|bmp)$/i;
const stemOf = (n) => n.replace(/\.[^.]+$/, "");

// Same rules as enroll.parse_name on the server: '6501234_สมชาย' -> code + name, 'อะตอม(1)' -> 'อะตอม'
function parseName(stem) {
  stem = stem.trim().replace(/\s*[\(\[]\d+[\)\]]$|[_\- ]\d{1,2}$/, "");
  const m = stem.match(/^(\d{5,})[\s_\-]+(.+)$/);
  return m ? { code: m[1], name: m[2].trim() } : { code: "", name: stem };
}

// Phone photos are 4000px+: shrink in the browser so uploads are fast (the server keeps 1280px anyway).
async function shrinkImage(file, maxSide = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (s === 1 && file.size < 1.5e6) { bmp.close && bmp.close(); return file; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92))) || file;
  } catch (_) { return file; }
}

// Files from a drop, including whole folders (each item keeps its relative path).
async function filesFromDrop(e) {
  const entries = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file: f, path: prefix + f.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

// Group like scan_folder: sub-folder = student, or file name = student ('ชื่อ(1).jpg' = extra photo).
function groupFiles(list) {
  const imgs = list.filter((x) => IMG_EXT.test(x.file.name));
  const parts = imgs.map((x) => x.path.split("/").filter(Boolean));
  const base = parts.length && parts.every((p) => p.length > 1 && p[0] === parts[0][0]) ? 1 : 0;   // the picked folder
  const rel = parts.map((p) => p.slice(base));
  const loose = rel.some((p) => p.length === 1);
  const groups = new Map();
  const ignored = new Set();
  imgs.forEach((x, i) => {
    const p = rel[i];
    if (loose && p.length > 1) { ignored.add(p[0]); return; }      // loose photos win, like the server
    const { code, name } = parseName(loose ? stemOf(p[0]) : p[0]);
    if (!name) return;
    if (!groups.has(name)) groups.set(name, { code, name, files: [] });
    groups.get(name).files.push(x.file);
  });
  return { layout: loose ? "files" : "subfolders", groups: [...groups.values()], ignored: [...ignored] };
}

// iPhone/iPad Safari cannot pick a folder (iPadOS reports itself as a Mac, so also check touch)
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const CAMERA_NAME = /^(IMG|DSC|PXL|image|photo)[_\- ]?\d+/i;   // default camera file names, not student names

function pickFiles({ folder = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true; input.accept = "image/*";
    if (folder) input.webkitdirectory = true;
    input.onchange = () => resolve([...input.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    input.click();
  });
}

function studentDialog(st, initialFiles = null) {
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">${st ? "นักศึกษา" : "เพิ่มนักศึกษา"}</div><h2>${st ? esc(st.name) : "นักศึกษาใหม่"}</h2></div>
      <button class="icon-btn" data-close>${ICONS.x}</button></div>
    <form class="form-grid" id="f">
      <label class="field">รหัสนักศึกษา<input class="input" name="student_code" value="${esc(st?.student_code || "")}"></label>
      <label class="field">ชื่อ-นามสกุล *<input class="input" name="name" required value="${esc(st?.name || "")}"></label>
      ${st ? `<label class="check full"><input type="checkbox" name="risk_group" ${st.risk_group ? "checked" : ""}>
        <span>อยู่ใน<b class="gold">กลุ่มเสี่ยง</b> (แฝด/หน้าคล้าย) — ต้องมั่นใจมากกว่าปกติ ถ้าไม่แน่ใจจะให้อาจารย์ยืนยัน
        ${st.risk_manual ? '<br><span class="muted small">ตั้งค่าเอง (ระบบจะไม่เปลี่ยนให้อัตโนมัติ)</span>' : ""}</span></label>` : ""}
    </form>
    ${st ? `<hr class="divider"><div class="row between"><h3>รูปอ้างอิง (${st.photos.length})</h3>
      <span class="muted small">${st.consent_at ? "ได้รับความยินยอม " + st.consent_at : ""}</span></div>
      <div class="photos" style="margin:12px 0">${st.photos.map((p) => `<div class="thumb ${p.warnings.length ? "warn" : ""}" style="width:84px;height:84px" title="${esc(p.warnings.join(" · ") || "รูปดี")}">
        <img src="${p.url}" alt=""><button class="x" data-old="${p.id}" title="ลบรูปนี้">✕</button></div>`).join("") || '<span class="muted">ยังไม่มีรูป</span>'}</div>
      ${st.photos.filter((p) => p.warnings.length).map((p) => `<div class="small" style="color:var(--warn)">• ${esc(p.warnings.join(" · "))}</div>`).join("")}` : ""}
    ${consentBlock("c2")}
    <div class="dropzone" id="dz" style="margin-top:14px">${ICONS.upload}<div>ลากรูปมาวาง หรือคลิกเพื่อเลือกรูป — ตรวจหน้าให้ทันที <b>บันทึกเข้าห้องเมื่อกด "บันทึก"</b></div>
      <div class="small">แนะนำ ${st?.risk_group ? "8–10" : "3–5"} รูป: หน้าตรง หันซ้าย/ขวาเล็กน้อย ต่างแสง ไม่ใส่แมสก์</div></div>
    <div class="up-grid" id="ups"></div>
    <div class="up-summary" id="up-sum"></div>
    <div class="modal-foot">
      ${st ? `<button class="btn danger" id="del" style="margin-right:auto">${ICONS.trash} ลบนักศึกษา</button>` : ""}
      <button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="save">บันทึก</button></div>`,
    { onClose: () => { if (changed) { loadStudents(); loadSection(); } },
      beforeClose: () => !pendingCount() || confirmBox("ทิ้งการแก้ไข?", "รูปที่เลือกไว้และรูปที่ทำเครื่องหมายลบ ยังไม่ได้บันทึก — ถ้าปิดตอนนี้จะไม่มีอะไรเปลี่ยน", { ok: "ทิ้ง", danger: true }) });

  // Nothing reaches the class until the teacher presses "บันทึก" and confirms:
  // picked photos are only checked (face found? quality?) and kept here; old photos are only marked for deletion.
  let changed = false;
  const staged = [];                 // {file, tile, kind: "checking"|"ok"|"warn"|"bad", note}
  const toDelete = new Set();        // ids of saved photos the teacher marked
  let checks = Promise.resolve();
  if (consentGiven) $("#c2", m.el).checked = true;
  const usable = () => staged.filter((s) => s.kind === "ok" || s.kind === "warn");
  const pendingCount = () => staged.length + toDelete.size;

  const summary = () => {
    const n = (k) => staged.filter((s) => s.kind === k).length;
    const parts = [];
    if (staged.length) parts.push(`พร้อมบันทึก <b class="gold">${usable().length}</b> / ${staged.length} รูป`);
    if (n("warn")) parts.push(`<span style="color:var(--warn)">ควรเปลี่ยน ${n("warn")}</span>`);
    if (n("bad")) parts.push(`<span style="color:var(--bad)">ไม่ผ่าน ${n("bad")} (จะไม่ถูกบันทึก)</span>`);
    if (n("checking")) parts.push(`<span class="muted">กำลังตรวจ ${n("checking")}…</span>`);
    if (toDelete.size) parts.push(`<span style="color:var(--bad)">จะลบรูปเดิม ${toDelete.size} รูป</span>`);
    $("#up-sum", m.el).innerHTML = parts.length ? parts.join(" · ") + ' · <span class="muted">ยังไม่ได้บันทึก</span>' : "";
  };

  const setTile = (s, kind, label, title = "") => {
    s.kind = kind;
    s.tile.className = `up-thumb ${kind === "checking" || kind === "saving" ? "busy" : kind}`;
    $(".st", s.tile).textContent = label;
    s.tile.title = title;
  };

  let waiting = [];
  $("#c2", m.el).addEventListener("change", (e) => {
    if (e.target.checked && waiting.length) { const w = waiting; waiting = []; addFiles(w); }
  });
  const addFiles = (files) => {
    if (!$("#c2", m.el).checked) {
      waiting = waiting.concat(files);
      $("#up-sum", m.el).innerHTML = `<span style="color:var(--warn)">ติ๊กยืนยันความยินยอมด้านบน เพื่อตรวจรูปที่เลือกไว้ ${waiting.length} รูป</span>`;
      return toast("กรุณาติ๊กยืนยันความยินยอมก่อนเพิ่มรูป", "warn");
    }
    consentGiven = true;
    for (const file of files) {
      const s = { file, tile: document.createElement("div"), kind: "checking" };
      s.tile.innerHTML = `<img src="${URL.createObjectURL(file)}" alt=""><button class="x" title="เอารูปนี้ออก">✕</button><div class="st"></div>`;
      $("#ups", m.el).append(s.tile);
      staged.push(s);
      setTile(s, "checking", "กำลังตรวจ");
      $(".x", s.tile).onclick = (e) => {
        e.stopPropagation();
        staged.splice(staged.indexOf(s), 1);
        s.tile.remove();
        summary();
      };
      checks = checks.then(async () => {
        if (!staged.includes(s)) return;                       // removed before it was checked
        try {
          s.small = await shrinkImage(file);
          const form = new FormData();
          form.append("file", s.small, file.name);
          form.append("consent", "true");
          const r = await api("/api/photos/check", { method: "POST", body: form });
          if (r.ok && r.face) $("img", s.tile).src = r.face;   // the face the system will use
          if (!r.ok) setTile(s, "bad", "✗ " + r.message, r.message);
          else if (r.warnings.length) setTile(s, "warn", "⚠ ควรเปลี่ยน", r.warnings.join(" · "));
          else setTile(s, "ok", "✓ ผ่าน · รอบันทึก", "รูปดี");
        } catch (err) { setTile(s, "bad", "✗ ตรวจไม่สำเร็จ", err.message); }
        summary();
      });
      summary();
    }
  };

  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.multiple = true;
  wireDropzone($("#dz", m.el), input, addFiles);
  if (initialFiles && initialFiles.length) addFiles(initialFiles);

  // saved photos: tap ✕ to mark for deletion (tap again to keep) — deleted only when saving
  $$("[data-old]", m.el).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const id = Number(b.dataset.old);
    const thumb = b.closest(".thumb");
    if (toDelete.has(id)) { toDelete.delete(id); thumb.classList.remove("marked"); b.textContent = "✕"; b.title = "ลบรูปนี้"; }
    else { toDelete.add(id); thumb.classList.add("marked"); b.textContent = "↺"; b.title = "ยกเลิกการลบ"; }
    summary();
  });

  $("#save", m.el).onclick = async () => {
    const form = $("#f", m.el);
    if (!form.reportValidity()) return;
    await checks;                                               // wait for photos still being checked
    const data = Object.fromEntries(new FormData(form));
    const add = usable();
    const skipped = staged.length - add.length;
    if (add.length || toDelete.size) {
      const lines = [];
      if (add.length) lines.push(`เพิ่มรูปใหม่ <b>${add.length}</b> รูป`);
      if (skipped) lines.push(`ข้ามรูปที่ไม่ผ่าน ${skipped} รูป`);
      if (toDelete.size) lines.push(`ลบรูปเดิม <b>${toDelete.size}</b> รูป (ถาวร)`);
      if (!(await confirmBox(`ยืนยันการบันทึก · ${data.name}`, lines.join("<br>"), { ok: "ยืนยันบันทึก" }))) return;
    }
    $("#save", m.el).disabled = true;
    $("#save", m.el).innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
    const body = { student_code: data.student_code, name: data.name };
    if (st) body.risk_group = !!form.risk_group.checked;
    const saved = await api(st ? `/api/students/${st.id}` : `/api/sections/${SECTION_ID}/students`, { method: st ? "PUT" : "POST", json: body });
    changed = true;
    for (const id of toDelete) await api(`/api/photos/${id}`, { method: "DELETE" });
    let ok = 0;
    const looks = new Set();
    for (const s of add) {
      setTile(s, "saving", "กำลังบันทึก");
      try {
        const f = new FormData();
        f.append("files", s.small || s.file, s.file.name);
        f.append("consent", "true");
        const res = await api(`/api/students/${saved.id}/photos`, { method: "POST", body: f });
        const r = res.results[0];
        res.lookalikes.forEach((l) => looks.add(`${l.name} (${l.similarity})`));
        if (r.ok) { ok++; setTile(s, r.warnings.length ? "warn" : "ok", "✓ บันทึกแล้ว"); }
        else setTile(s, "bad", "✗ " + r.message, r.message);
      } catch (err) { setTile(s, "bad", "✗ บันทึกไม่สำเร็จ", err.message); }
    }
    staged.length = 0; toDelete.clear();
    m.close();
    toast(add.length ? `บันทึก ${saved.name} แล้ว · เพิ่มรูป ${ok}/${add.length}` : `บันทึก ${saved.name} แล้ว`);
    if (looks.size) toast(`หน้าคล้าย: ${[...looks].join(", ")} — จัดเข้ากลุ่มเสี่ยงแล้ว`, "warn", 6000);
  };
  if (st) $("#del", m.el).onclick = async () => {
    if (!(await confirmBox(`ลบ ${st.name}?`, "ข้อมูลนักศึกษา รูปใบหน้า embedding และประวัติการเช็คชื่อของคนนี้จะถูกลบถาวร", { ok: "ลบถาวร", danger: true }))) return;
    await api(`/api/students/${st.id}`, { method: "DELETE" });
    m.close(); toast("ลบนักศึกษาแล้ว"); loadStudents(); loadSection();
  };
}

// ---------------------------------------------------------------- folder import
async function importDialog() {
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">Bulk import</div><h2>นำเข้าจากโฟลเดอร์</h2></div><button class="icon-btn" data-close>${ICONS.x}</button></div>
    <div class="row"><input class="input grow" id="folder" placeholder="เว้นว่าง = โฟลเดอร์ใน config.yaml"><button class="btn" id="scan">ตรวจโฟลเดอร์</button></div>
    <div id="preview" style="margin-top:16px"><div class="spinner"></div></div>
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="go" disabled>นำเข้า</button></div>`, { wide: true });
  let data = null;
  const scan = async () => {
    $("#preview", m.el).innerHTML = '<div class="spinner"></div>';
    try { data = await api(`/api/import/preview?folder=${encodeURIComponent($("#folder", m.el).value)}`); }
    catch (_) { $("#preview", m.el).innerHTML = ""; return; }
    $("#folder", m.el).value = data.folder;
    $("#preview", m.el).innerHTML = `
      <div class="list-item" style="background:var(--info-bg)"><div><b>ระบบตีความว่า:</b> ${esc(data.layout_th)}<div class="small muted">พบ ${data.students.length} คน · ชื่อที่ขึ้นต้นด้วยรหัส 5 หลักขึ้นไป เช่น "6501234_สมชาย" จะแยกเป็นรหัส + ชื่อให้${data.ignored_folders && data.ignored_folders.length ? `<br>ข้ามโฟลเดอร์ย่อย: ${data.ignored_folders.map(esc).join(", ")}` : ""}</div></div></div>
      <p class="small muted">ติ๊กออกเพื่อข้ามคนที่ไม่ต้องการ (เช่น รูปที่ยังไม่แน่ใจว่าเป็นใคร)</p>
      <div class="grid cols-4" style="gap:8px">${data.students.map((s, i) => `<label class="check list-item"><input type="checkbox" data-name="${esc(s.name)}" checked>
        <span><b>${esc(s.name)}</b> ${s.code ? `<span class="muted small">${esc(s.code)}</span>` : ""}<br><span class="muted small">${s.files.length} รูป: ${esc(s.files.join(", "))}</span></span></label>`).join("")}</div>
      ${consentBlock("c3")}`;
    $("#go", m.el).disabled = false;
  };
  $("#scan", m.el).onclick = scan;
  $("#go", m.el).onclick = async () => {
    if (!$("#c3", m.el).checked) return toast("กรุณาติ๊กยืนยันความยินยอมก่อน", "warn");
    const skip = $$("input[data-name]", m.el).filter((c) => !c.checked).map((c) => c.dataset.name);
    $("#go", m.el).disabled = true;
    $("#go", m.el).innerHTML = '<span class="spinner"></span> กำลังประมวลผลรูป...';
    const report = await api(`/api/sections/${SECTION_ID}/import`, { method: "POST", json: { folder: data.folder, skip, consent: true } });
    consentGiven = true;
    m.close();
    showImportReport(report);
    loadStudents(); loadSection();
  };
  scan();
}

function showImportReport(report) {
  openModal(`<div class="modal-head"><div><div class="eyebrow">สำเร็จ</div><h2>นำเข้า ${report.students.length} คน</h2></div><button class="icon-btn" data-close>${ICONS.x}</button></div>
    ${report.lookalikes ? `<div class="list-item" style="background:var(--warn-bg);margin-bottom:12px">${ICONS.twin}<div>พบคู่ที่หน้าคล้ายกัน ${report.lookalikes} คู่ — จัดเข้ากลุ่มเสี่ยงแล้ว ดูได้ที่แท็บ "ตรวจความคล้าย"</div></div>` : ""}
    ${report.problems.length ? `<h3 style="margin-bottom:10px">รูปที่ควรตรวจ (${report.problems.length})</h3>
      <div class="list">${report.problems.map((p) => `<div class="list-item"><span class="badge warn">ตรวจ</span><div><div>${esc(p.file)}</div><div class="muted small">${esc(p.message)}</div></div></div>`).join("")}</div>` : '<p class="muted">ทุกรูปผ่านการตรวจคุณภาพ</p>'}
    <div class="modal-foot"><button class="btn gold" data-close>ตกลง</button></div>`, { wide: true });
}

// Many students at once, from the teacher's own computer (works on the deployed site):
// pick/drop a folder (sub-folder per student, or file name = student) or just many photos.
function multiDialog() {
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">หลายคนพร้อมกัน</div><h2>นำเข้ารูปนักศึกษา</h2></div><button class="icon-btn" data-close>${ICONS.x}</button></div>
    <div class="list-item" style="background:var(--info-bg);display:block"><b>ตั้งชื่อได้ 2 แบบ</b>
      <div class="small muted">① โฟลเดอร์ย่อยต่อคน: <b>สมชาย/</b>1.jpg, 2.jpg &nbsp;·&nbsp; ② ไฟล์รวม: <b>สมชาย.jpg</b>, <b>สมชาย(1).jpg</b>
      &nbsp;·&nbsp; ขึ้นต้นด้วยรหัส เช่น <b>6501234_สมชาย</b> จะแยกรหัสให้ · คนที่มีอยู่แล้วจะถูกเพิ่มรูปให้</div></div>
    <div class="dropzone" id="dz" style="margin-top:14px">${ICONS.upload}<div>${IS_IOS ? "เลือกรูปจากแอปไฟล์ (Files)" : "ลากโฟลเดอร์หรือรูปมาวางตรงนี้"}</div>
      <div class="row">${IS_IOS ? "" : `<button class="btn sm" id="pick-dir">${ICONS.folder} เลือกโฟลเดอร์</button>`}<button class="btn sm" id="pick-files">${ICONS.upload} เลือกรูป</button></div></div>
    ${IS_IOS ? `<p class="small" style="color:var(--warn);margin:8px 0 0">iPhone/iPad เลือกทั้งโฟลเดอร์ไม่ได้ — เลือกหลายรูปจากแอปไฟล์ที่ตั้งชื่อไฟล์เป็นชื่อนักศึกษาไว้แล้ว
      หรือใช้ปุ่ม "เพิ่มนักศึกษา" ทีละคน (เลือกจากคลังรูปหรือถ่ายจากกล้องได้)</p>` : ""}
    <div id="preview"></div>
    ${consentBlock("c4")}
    <div class="modal-foot">
      <button class="btn ghost sm" id="server" style="margin-right:auto" title="ใช้ตอนรันบนเครื่องตัวเอง">โฟลเดอร์บนเซิร์ฟเวอร์</button>
      <button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="go" disabled>นำเข้า</button></div>`,
    { wide: true, onClose: () => { if (done) { loadStudents(); loadSection(); } },
      beforeClose: () => {
        if (running) { toast("กำลังนำเข้าอยู่ รอให้เสร็จก่อน", "warn"); return false; }
        return done || !chosen().length || confirmBox("ทิ้งรายการนี้?", "ยังไม่ได้กดนำเข้า — ถ้าปิดตอนนี้จะไม่มีอะไรถูกบันทึก", { ok: "ทิ้ง", danger: true });
      } });

  let groups = [];
  let done = false;
  let running = false;
  const known = new Set(students.map((s) => s.name));

  let meta = { layout: "", ignored: [] };
  const urls = new Map();                                  // one preview URL per file
  const urlOf = (f) => { if (!urls.has(f)) urls.set(f, URL.createObjectURL(f)); return urls.get(f); };
  const live = () => groups.filter((g) => !g.removed);
  const chosen = () => live().filter((g) => g.use && g.files.length);

  const rowHtml = (g, i) => `
    <div class="list-item group-row" data-i="${i}">
      <input type="checkbox" data-use ${g.use ? "checked" : ""} title="ติ๊กออก = ข้ามคนนี้">
      <div style="min-width:0">
        <div class="row" style="gap:6px">
          <input class="input sm" data-name value="${esc(g.name)}" placeholder="ชื่อนักศึกษา *" style="max-width:220px">
          <input class="input sm" data-code value="${esc(g.code)}" placeholder="รหัส (ไม่บังคับ)" style="max-width:150px">
          ${known.has(g.name) ? '<span class="badge line">มีอยู่แล้ว · เพิ่มรูป</span>' : ""}
          ${CAMERA_NAME.test(g.name) ? '<span class="badge warn">ชื่อจากกล้อง? แก้ชื่อก่อน</span>' : ""}
        </div>
        <div class="mini" style="margin-top:8px">${g.files.map((f, j) => `<span class="mini-ph"><img src="${urlOf(f)}" alt="">
          <button class="x" data-rm="${j}" title="เอารูปนี้ออก">✕</button></span>`).join("")}
          <button class="btn sm ghost" data-add title="เพิ่มรูปให้คนนี้">${ICONS.plus} รูป</button></div>
      </div>
      <div class="row" style="gap:6px" data-side><span class="badge line" data-st>${g.files.length} รูป</span>
        <button class="icon-btn" data-del title="เอาคนนี้ออกจากรายการ">${ICONS.trash}</button></div>
    </div>`;

  const summary = () => {
    const use = chosen();
    const n = use.reduce((a, g) => a + g.files.length, 0);
    const el = $("#sum", m.el);
    if (el) el.innerHTML = `พบ <b class="gold">${live().length}</b> คน · เลือกนำเข้า <b class="gold">${use.length}</b> คน ${n} รูป` +
      (meta.layout ? ` · ${meta.layout === "subfolders" ? "แยกโฟลเดอร์ต่อคน" : "ชื่อไฟล์ = ชื่อนักศึกษา"}` : "") +
      (meta.ignored.length ? `<span class="muted"> · ข้ามโฟลเดอร์ย่อย: ${meta.ignored.map(esc).join(", ")}</span>` : "") +
      `<span class="muted"> · แก้ชื่อ/รหัส เพิ่มหรือลบรูปของแต่ละคนได้ก่อนกดนำเข้า</span>`;
    $("#go", m.el).disabled = !use.length;
    $("#go", m.el).textContent = `นำเข้า ${use.length} คน`;
  };

  const wireRow = (row) => {
    const g = groups[row.dataset.i];
    $("[data-use]", row).onchange = (e) => { g.use = e.target.checked; summary(); };
    $("[data-name]", row).oninput = (e) => { g.name = e.target.value.trim(); summary(); };
    $("[data-code]", row).oninput = (e) => { g.code = e.target.value.trim(); };
    $$("[data-rm]", row).forEach((b) => b.onclick = () => { g.files.splice(Number(b.dataset.rm), 1); redrawRow(row); });
    $("[data-add]", row).onclick = async () => {
      const more = (await pickFiles()).filter((x) => IMG_EXT.test(x.file.name)).map((x) => x.file);
      if (more.length) { g.files.push(...more); g.use = true; redrawRow(row); }
    };
    $("[data-del]", row).onclick = () => { g.removed = true; row.remove(); summary(); };
  };
  const redrawRow = (row) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(groups[row.dataset.i], row.dataset.i);
    const fresh = tmp.firstElementChild;
    row.replaceWith(fresh);
    wireRow(fresh);
    summary();
  };

  const draw = () => {
    $("#preview", m.el).innerHTML = `
      <p class="small" id="sum" style="margin:14px 0 8px"></p>
      ${groups.some((g) => CAMERA_NAME.test(g.name)) ? `<p class="small" style="color:var(--warn);margin:0 0 8px">⚠ บางคนได้ชื่อจากชื่อไฟล์กล้อง (เช่น IMG_1234) — พิมพ์ชื่อจริงในช่องชื่อได้เลย</p>` : ""}
      <div class="progress hidden" id="bar"><i></i></div><div class="small muted" id="bar-txt"></div>
      <div class="list" id="glist" style="max-height:46vh;overflow:auto">${groups.map(rowHtml).join("")}</div>
      <button class="btn sm" id="add-person" style="margin-top:8px">${ICONS.plus} เพิ่มคน (เลือกรูปเอง)</button>`;
    $$("#glist .group-row", m.el).forEach(wireRow);
    $("#add-person", m.el).onclick = () => {
      groups.push({ code: "", name: "", files: [], use: true });
      const tmp = document.createElement("div");
      tmp.innerHTML = rowHtml(groups[groups.length - 1], groups.length - 1);
      const row = tmp.firstElementChild;
      $("#glist", m.el).append(row);
      wireRow(row);
      $("[data-name]", row).focus();
      summary();
    };
    summary();
  };
  const load = (list) => {
    if (running || !list.length) return;
    const data = groupFiles(list);
    meta = data;
    groups = data.groups.map((g) => ({ ...g, use: true }));
    if (!groups.length) toast("ไม่พบรูป (.jpg .png .webp)", "warn");
    draw();
  };
  draw();

  const dz = $("#dz", m.el);
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", async (e) => load(await filesFromDrop(e)));
  if (!IS_IOS) $("#pick-dir", m.el).onclick = async (e) => { e.stopPropagation(); load(await pickFiles({ folder: true })); };
  $("#pick-files", m.el).onclick = async (e) => { e.stopPropagation(); load(await pickFiles()); };
  $("#server", m.el).onclick = () => { m.close(); importDialog(); };

  $("#go", m.el).onclick = async () => {
    if (done) return m.close();
    if (!$("#c4", m.el).checked) return toast("กรุณาติ๊กยืนยันความยินยอมก่อน", "warn");
    const todo = chosen();
    if (!todo.length) return toast("ยังไม่ได้เลือกใคร", "warn");
    if (todo.some((g) => !g.name)) return toast("ยังมีคนที่ไม่ได้ใส่ชื่อ", "warn");
    const nPhotos = todo.reduce((a, g) => a + g.files.length, 0);
    if (!(await confirmBox(`ยืนยันนำเข้า ${todo.length} คน?`, `รูป ${nPhotos} รูปจะถูกบันทึกเข้าห้องนี้ (คนที่มีอยู่แล้วจะถูกเพิ่มรูป)`, { ok: "ยืนยันบันทึก" }))) return;
    consentGiven = true; running = true;
    $("#go", m.el).disabled = true;
    $$("#glist input, #glist button, #add-person", m.el).forEach((c) => c.disabled = true);
    $("#bar", m.el).classList.remove("hidden");
    const totalPhotos = todo.reduce((a, g) => a + g.files.length, 0);
    let sent = 0, okPeople = 0, okPhotos = 0, problems = 0, looks = 0;
    for (const g of todo) {
      const row = $(`[data-i="${groups.indexOf(g)}"]`, m.el);
      const badge = $("[data-st]", row);
      badge.className = "badge warn"; badge.innerHTML = '<span class="spinner"></span> กำลังอัป';
      row.scrollIntoView({ block: "nearest" });
      const label = g.code ? `${g.code}_${g.name}` : g.name;
      let ok = 0; const notes = [];
      for (let k = 0; k < g.files.length; k += 4) {            // small requests: fast feedback, no size limit issues
        const chunk = g.files.slice(k, k + 4);
        const form = new FormData();
        for (const [j, f] of chunk.entries()) form.append("files", await shrinkImage(f), `${label}(${k + j + 1}).jpg`);
        form.append("consent", "true");
        try {
          const rep = await api(`/api/sections/${SECTION_ID}/bulk`, { method: "POST", body: form });
          ok += rep.students.length;
          looks = Math.max(looks, rep.lookalikes || 0);
          rep.problems.forEach((p) => notes.push(p.message));
        } catch (err) { notes.push(err.message); }
        sent += chunk.length;
        $("#bar > i", m.el).style.width = `${Math.round((sent / totalPhotos) * 100)}%`;
        $("#bar-txt", m.el).textContent = `กำลังอัป ${todo.indexOf(g) + 1}/${todo.length} คน · ${sent}/${totalPhotos} รูป`;
      }
      okPhotos += ok; problems += notes.length;
      if (ok) okPeople++;
      badge.className = `badge ${!ok ? "bad" : notes.length ? "warn" : "ok"}`;
      badge.textContent = !ok ? "✗ ไม่ผ่าน" : `✓ ${ok}/${g.files.length} รูป${notes.length ? " · ⚠" : ""}`;
      badge.title = notes.join("\n");
      done = true;
    }
    running = false;
    // after import: open any person to rename, add or delete photos (same dialog as the student card)
    students = await api(`/api/sections/${SECTION_ID}/students`);
    for (const g of todo) {
      const st = students.find((s) => s.name === g.name);
      const side = $(`[data-i="${groups.indexOf(g)}"] [data-side]`, m.el);
      if (!st || !side) continue;
      const b = document.createElement("button");
      b.className = "btn sm"; b.innerHTML = `${ICONS.edit} แก้ไข / เพิ่มรูป`;
      b.onclick = async () => {
        const fresh = (await api(`/api/sections/${SECTION_ID}/students`)).find((s) => s.id === st.id);
        if (fresh) studentDialog(fresh);
      };
      $("[data-del]", side)?.remove();
      side.append(b);
    }
    $("#bar-txt", m.el).innerHTML = `<b class="gold">เสร็จแล้ว</b> · นำเข้า ${okPeople}/${todo.length} คน · ${okPhotos}/${totalPhotos} รูป` +
      (problems ? ` · <span style="color:var(--warn)">มี ${problems} รูปที่ควรตรวจ (ชี้ที่ป้ายเพื่อดูเหตุผล)</span>` : "") +
      (looks ? ` · <span style="color:var(--warn)">หน้าคล้าย ${looks} คู่ — จัดเข้ากลุ่มเสี่ยงแล้ว</span>` : "");
    $("#go", m.el).disabled = false;
    $("#go", m.el).textContent = "ปิด";
    toast(`นำเข้า ${okPeople} คน · ${okPhotos} รูป`);
  };
}

// ---------------------------------------------------------------- similarity
function heatColor(v, threshold) {
  // navy (low) -> gold (near threshold) -> red (above)
  if (v >= 0.999) return "transparent";
  if (v >= threshold) return `rgba(228,107,107,${0.55 + Math.min(0.45, (v - threshold) * 2)})`;
  const t = Math.max(0, v) / threshold;
  return `rgba(201,169,110,${0.06 + t * t * 0.7})`;
}

async function loadSimilarity() {
  const box = $("#tab-similar");
  box.innerHTML = '<div class="spinner"></div>';
  const d = await api(`/api/sections/${SECTION_ID}/similarity`);
  if (d.people.length < 2) { box.innerHTML = '<div class="empty">ต้องมีนักศึกษาที่มีรูปอย่างน้อย 2 คน</div>'; return; }
  const n = d.people.length;
  const cols = `110px repeat(${n}, minmax(26px, 1fr))`;
  let cells = `<div></div>` + d.people.map((p) => `<div class="lbl col-lbl" title="${esc(p.name)}">${esc(p.name)}</div>`).join("");
  d.people.forEach((p, i) => {
    cells += `<div class="lbl" title="${esc(p.name)}">${p.risk ? '<span class="gold">●&nbsp;</span>' : ""}${esc(p.name)}</div>`;
    cells += d.matrix[i].map((v, j) => `<div class="cell" style="background:${i === j ? "var(--surface-2)" : heatColor(v, d.threshold)}"
      title="${esc(p.name)} ↔ ${esc(d.people[j].name)}: ${v}">${i !== j && v >= d.threshold * 0.75 ? v.toFixed(2) : ""}</div>`).join("");
  });
  box.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start" id="sim-grid">
      <div class="card">
        <div class="row between"><h3>Heatmap ความคล้าย</h3><span class="badge line">เกณฑ์เตือน ${d.threshold}</span></div>
        <p class="muted small">ค่า cosine similarity สูงสุดระหว่างรูปของแต่ละคู่ · สีแดง = เกินเกณฑ์ (อาจเป็นแฝด/หน้าคล้าย) · <span class="gold">●</span> = กลุ่มเสี่ยง</p>
        <div class="heatmap" style="grid-template-columns:${cols}">${cells}</div>
      </div>
      <div class="card">
        <div class="row between"><h3>คู่ที่คล้ายกันที่สุด</h3><button class="btn sm" id="refresh">คำนวณกลุ่มเสี่ยงใหม่</button></div>
        <div class="stack" style="margin-top:14px">${d.pairs.slice(0, 8).map(pairCard).join("")}</div>
      </div>
    </div>`;
  if (innerWidth < 1000) $("#sim-grid").style.gridTemplateColumns = "1fr";
  $("#refresh").onclick = async () => { const r = await api(`/api/sections/${SECTION_ID}/risk/refresh`, { method: "POST" }); toast(`พบ ${r.pairs} คู่ที่เกินเกณฑ์`); loadSimilarity(); loadSection(); };
  $$("[data-risk]", box).forEach((b) => b.onclick = async () => {
    const st = students.find((s) => s.id == b.dataset.risk) || (await api(`/api/sections/${SECTION_ID}/students`)).find((s) => s.id == b.dataset.risk);
    await api(`/api/students/${st.id}`, { method: "PUT", json: { student_code: st.student_code, name: st.name, risk_group: b.dataset.to === "1" } });
    toast(b.dataset.to === "1" ? `เพิ่ม ${st.name} เข้ากลุ่มเสี่ยงแล้ว` : `นำ ${st.name} ออกจากกลุ่มเสี่ยงแล้ว`);
    students = await api(`/api/sections/${SECTION_ID}/students`);
    loadSimilarity(); loadSection();
  });
}

function pairCard(p) {
  const side = (s) => `<div class="side">
    <div class="photos" style="justify-content:center">${s.photos.slice(0, 3).map((u) => `<div class="thumb" style="width:70px;height:70px"><img src="${u}" alt=""></div>`).join("")}</div>
    <b>${esc(s.name)}</b>
    <button class="btn sm ${s.risk ? "" : "ghost"}" data-risk="${s.id}" data-to="${s.risk ? 0 : 1}">${s.risk ? "✓ กลุ่มเสี่ยง (เอาออก)" : "+ เข้ากลุ่มเสี่ยง"}</button></div>`;
  return `<div class="list-item" style="display:block"><div class="pair">${side(p.a)}<div class="score">${p.similarity.toFixed(2)}<div class="small muted" style="font-family:var(--font-body)">similarity</div></div>${side(p.b)}</div></div>`;
}

// ---------------------------------------------------------------- history
async function loadHistory() {
  const box = $("#tab-history");
  const list = await api(`/api/sections/${SECTION_ID}/sessions`);
  if (!list.length) { box.innerHTML = '<div class="empty">ยังไม่มีคาบที่เช็คชื่อ</div>'; return; }
  box.innerHTML = `<div class="card table-wrap"><table class="table">
    <thead><tr><th>วันที่</th><th>เริ่มคาบ</th><th>สถานะ</th><th>มา</th><th>สาย</th><th>ขาด</th><th>ยืนยันตัวตน</th><th>สงสัยปลอม</th><th></th></tr></thead>
    <tbody>${list.map((s) => `<tr>
      <td><b>${s.date}</b></td><td>${s.start} น.</td>
      <td>${s.closed ? `<span class="badge line">ปิดแล้ว ${s.closed_at}</span>` : '<span class="badge ok">กำลังเช็ค</span>'}</td>
      <td style="color:var(--ok)">${s.summary.present}</td><td style="color:var(--warn)">${s.summary.late}</td><td style="color:var(--bad)">${s.summary.absent}</td>
      <td>${s.confirm}</td><td>${s.spoof ? `<span class="badge bad">${s.spoof}</span>` : 0}</td>
      <td class="row" style="justify-content:flex-end;gap:6px">
        ${s.closed ? "" : `<a class="btn gold sm" href="/live.html?session=${s.id}">กลับไปเช็คต่อ</a>`}
        <button class="btn sm" data-view="${s.id}">รายละเอียด</button>
        <a class="btn sm" href="/api/sessions/${s.id}/excel">${ICONS.download} Excel</a>
        <button class="btn ghost sm" data-del="${s.id}" title="ลบคาบนี้">${ICONS.trash}</button></td></tr>`).join("")}</tbody></table></div>`;
  $$("[data-view]", box).forEach((b) => b.onclick = () => sessionDetail(b.dataset.view));
  $$("[data-del]", box).forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("ลบคาบนี้?", "บันทึกการเช็คชื่อและภาพหลักฐานของคาบนี้จะถูกลบถาวร", { ok: "ลบ", danger: true }))) return;
    await api(`/api/sessions/${b.dataset.del}`, { method: "DELETE" });
    loadHistory();
  });
}

async function sessionDetail(id) {
  const [s, events] = await Promise.all([api(`/api/sessions/${id}`), api(`/api/sessions/${id}/events`)]);
  const statusBadge = { present: "ok", late: "warn", absent: "bad" };
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">${s.date} · เริ่ม ${s.start} น. · สายหลัง ${s.late_minutes} นาที</div><h2>รายละเอียดคาบ</h2></div>
      <button class="icon-btn" data-close>${ICONS.x}</button></div>
    <div class="counts" style="margin-bottom:16px">
      <div class="count ok"><b>${s.summary.present}</b><span>มา</span></div><div class="count warn"><b>${s.summary.late}</b><span>สาย</span></div>
      <div class="count bad"><b>${s.summary.absent}</b><span>ขาด</span></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th>เวลา</th><th>วิธี</th><th>similarity</th></tr></thead>
      <tbody>${s.roster.map((r) => `<tr><td>${esc(r.code || "-")}</td><td>${esc(r.name)} ${r.flagged ? '<span class="badge bad">สงสัยปลอม</span>' : ""}</td>
        <td><span class="badge ${statusBadge[r.status]}">${r.status_th}</span></td><td>${r.checked_at || "-"}</td><td>${r.method_th || "-"}</td><td>${r.similarity ?? "-"}</td></tr>`).join("")}</tbody></table></div>
    ${events.length ? `<hr class="divider"><h3 style="margin-bottom:12px">บันทึกเหตุการณ์ (${events.length})</h3>${eventsHtml(events)}` : ""}
    <div class="modal-foot"><a class="btn gold" href="/api/sessions/${id}/excel">${ICONS.download} ดาวน์โหลด Excel</a></div>`, { wide: true });
  wireReview(m.el, () => { m.close(); sessionDetail(id); });
}

function eventsHtml(events) {
  return `<div class="evidence">${events.map((e) => `<figure>
    ${e.image ? `<a href="${e.full || e.image}" target="_blank"><img src="${e.image}" alt=""></a>` : `<div style="aspect-ratio:1;display:grid;place-items:center" class="muted">ไม่มีภาพ</div>`}
    <figcaption><span class="badge ${e.kind === "spoof" ? "bad" : e.kind === "confirm" ? "ok" : "line"}">${esc(e.kind_th)}</span>
      <span>${e.at} ${e.student ? "· " + esc(e.student) : ""}</span>
        ${e.detail && e.detail.reason_th ? `<span class="small muted">${esc(e.detail.reason_th)}</span>` : ""}
      ${e.kind === "spoof" ? (e.reviewed ? `<span class="small muted">ตรวจแล้ว: ${e.reviewed === "live" ? "คนจริง (ระบบพลาด)" : "ภาพปลอมจริง"}</span>`
        : `<span class="row" style="gap:4px"><button class="btn sm ok" data-review="${e.id}" data-v="spoof">ปลอมจริง</button><button class="btn sm" data-review="${e.id}" data-v="live">คนจริง</button></span>`) : ""}
    </figcaption></figure>`).join("")}</div>`;
}

function wireReview(root, after) {
  $$("[data-review]", root).forEach((b) => b.onclick = async () => {
    await api(`/api/events/${b.dataset.review}/review`, { method: "POST", json: { verdict: b.dataset.v } });
    toast("บันทึกผลตรวจแล้ว (ใช้ปรับปรุงโมเดล anti-spoof ได้)");
    after();
  });
}

// ---------------------------------------------------------------- start
loadSection();
showTab(params.get("tab") || "students");
