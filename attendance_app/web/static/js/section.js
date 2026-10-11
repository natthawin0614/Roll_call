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
  <button class="btn" id="import-btn">${ICONS.folder} นำเข้าจากโฟลเดอร์</button>
  <button class="btn" id="bulk-btn">${ICONS.upload} อัปโหลดหลายคน</button>
  <button class="btn gold" id="add-btn">${ICONS.plus} เพิ่มนักศึกษา</button>`;
$("#import-btn").onclick = importDialog;
$("#bulk-btn").onclick = bulkDialog;
$("#add-btn").onclick = () => studentDialog(null);

// ---------------------------------------------------------------- students
async function loadStudents() {
  students = await api(`/api/sections/${SECTION_ID}/students`);
  const box = $("#tab-students");
  if (!students.length) {
    box.innerHTML = `<div class="empty"><h3 style="margin-bottom:8px">ยังไม่มีนักศึกษา</h3>
      <p>นำเข้ารูปจากโฟลเดอร์ (ชื่อไฟล์ = ชื่อนักศึกษา) หรือเพิ่มทีละคน แนะนำ 3–5 รูปต่อคน ต่างมุม ต่างแสง</p>
      <div class="row" style="justify-content:center"><button class="btn gold" onclick="importDialog()">${ICONS.folder} นำเข้าจากโฟลเดอร์</button>
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
      if (files.length) withConsent(() => uploadPhotos(st, files));
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

function withConsent(action) {
  if (consentGiven) return action();
  const m = openModal(`<div class="modal-head"><div><div class="eyebrow">PDPA</div><h3>ขอความยินยอมก่อนเพิ่มรูปใบหน้า</h3></div></div>
    ${consentBlock("c1")}
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="ok">ยืนยัน</button></div>`);
  $("#ok", m.el).onclick = () => {
    if (!$("#c1", m.el).checked) return toast("กรุณาติ๊กยืนยันความยินยอม", "warn");
    consentGiven = true;
    m.close();
    action();
  };
}

async function uploadPhotos(st, files) {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("consent", "true");
  toast(`กำลังประมวลผล ${files.length} รูป...`, "warn", 1500);
  const res = await api(`/api/students/${st.id}/photos`, { method: "POST", body: form });
  showUploadResults(st.name, res);
  await loadStudents();
  loadSection();
  return res;
}

function showUploadResults(name, res) {
  const bad = res.results.filter((r) => !r.ok || r.warnings.length);
  const okCount = res.results.filter((r) => r.ok).length;
  if (!bad.length && !res.lookalikes.length) return toast(`เพิ่มรูปของ ${name} แล้ว ${okCount} รูป`);
  openModal(`<div class="modal-head"><h3>ผลการเพิ่มรูป · ${esc(name)}</h3><button class="icon-btn" data-close>${ICONS.x}</button></div>
    <p>เพิ่มสำเร็จ <b class="gold">${okCount}</b> / ${res.results.length} รูป</p>
    <div class="list">${bad.map((r) => `<div class="list-item"><span class="badge ${r.ok ? "warn" : "bad"}">${r.ok ? "เตือน" : "ไม่ผ่าน"}</span>
      <div><div>${esc(r.file)}</div><div class="muted small">${esc(r.ok ? r.warnings.join(" · ") : r.message)}</div></div></div>`).join("")}</div>
    ${res.lookalikes.length ? `<hr class="divider"><div class="list-item" style="background:var(--warn-bg)"><span class="gold">${ICONS.twin}</span>
      <div><b>อาจเป็นแฝด / หน้าคล้าย</b><div class="small">${res.lookalikes.map((l) => `${esc(l.name)} (${l.similarity})`).join(", ")}
      — ระบบจัดเข้ากลุ่มเสี่ยงให้แล้ว แนะนำเพิ่มรูปเป็น 8–10 รูปต่อคน</div></div></div>` : ""}
    <div class="modal-foot"><button class="btn gold" data-close>ตกลง</button></div>`);
}

async function deletePhoto(id) {
  if (!(await confirmBox("ลบรูปนี้?", "รูปและ embedding ของรูปนี้จะถูกลบถาวร", { ok: "ลบ", danger: true }))) return;
  await api(`/api/photos/${id}`, { method: "DELETE" });
  toast("ลบรูปแล้ว");
  loadStudents();
  loadSection();
}

function studentDialog(st) {
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
        <img src="${p.url}" alt=""></div>`).join("") || '<span class="muted">ยังไม่มีรูป</span>'}</div>
      ${st.photos.filter((p) => p.warnings.length).map((p) => `<div class="small" style="color:var(--warn)">• ${esc(p.warnings.join(" · "))}</div>`).join("")}` : ""}
    <div class="dropzone" id="dz" style="margin-top:14px">${ICONS.upload}<div>ลากรูปมาวาง หรือคลิกเพื่อเลือกรูป</div>
      <div class="small">แนะนำ ${st?.risk_group ? "8–10" : "3–5"} รูป: หน้าตรง หันซ้าย/ขวาเล็กน้อย ต่างแสง ไม่ใส่แมสก์</div></div>
    <div id="pending" class="small gold" style="margin-top:8px"></div>
    ${consentBlock("c2")}
    <div class="modal-foot">
      ${st ? `<button class="btn danger" id="del" style="margin-right:auto">${ICONS.trash} ลบนักศึกษา</button>` : ""}
      <button class="btn ghost" data-close>ปิด</button><button class="btn gold" id="save">บันทึก</button></div>`);

  let files = [];
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.multiple = true;
  wireDropzone($("#dz", m.el), input, (f) => { files = files.concat(f); $("#pending", m.el).textContent = `เลือกไว้ ${files.length} รูป (จะอัปโหลดเมื่อกดบันทึก)`; });
  if (consentGiven) $("#c2", m.el).checked = true;

  $("#save", m.el).onclick = async () => {
    const form = $("#f", m.el);
    if (!form.reportValidity()) return;
    if (files.length && !$("#c2", m.el).checked) return toast("กรุณาติ๊กยืนยันความยินยอมก่อนเพิ่มรูป", "warn");
    const data = Object.fromEntries(new FormData(form));
    const body = { student_code: data.student_code, name: data.name };
    if (st) body.risk_group = !!form.risk_group.checked;
    const saved = await api(st ? `/api/students/${st.id}` : `/api/sections/${SECTION_ID}/students`, { method: st ? "PUT" : "POST", json: body });
    m.close();
    if (files.length) { consentGiven = true; await uploadPhotos(saved, files); }
    else { toast("บันทึกแล้ว"); loadStudents(); loadSection(); }
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

function bulkDialog() {
  const m = openModal(`
    <div class="modal-head"><div><div class="eyebrow">หลายคนพร้อมกัน</div><h2>อัปโหลดรูปหลายคน</h2></div><button class="icon-btn" data-close>${ICONS.x}</button></div>
    <p class="muted small">ตั้งชื่อไฟล์เป็นชื่อนักศึกษา เช่น <b>สมชาย.jpg</b>, <b>สมชาย(1).jpg</b> หรือ <b>6501234_สมชาย.jpg</b> — คนที่มีอยู่แล้วจะถูกเพิ่มรูปให้</p>
    <div class="dropzone" id="dz">${ICONS.upload}<div>ลากรูปทั้งหมดมาวาง หรือคลิกเพื่อเลือก</div></div>
    <div id="pending" class="small gold" style="margin-top:8px"></div>
    ${consentBlock("c4")}
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn gold" id="go">อัปโหลด</button></div>`);
  let files = [];
  wireDropzone($("#dz", m.el), $("#file-input"), (f) => { files = files.concat(f); $("#pending", m.el).textContent = `เลือกไว้ ${files.length} รูป`; });
  $("#go", m.el).onclick = async () => {
    if (!files.length) return toast("ยังไม่ได้เลือกรูป", "warn");
    if (!$("#c4", m.el).checked) return toast("กรุณาติ๊กยืนยันความยินยอมก่อน", "warn");
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("consent", "true");
    $("#go", m.el).innerHTML = '<span class="spinner"></span> กำลังประมวลผล...';
    const report = await api(`/api/sections/${SECTION_ID}/bulk`, { method: "POST", body: form });
    consentGiven = true;
    m.close();
    showImportReport({ ...report, students: [...new Set(report.students.map((s) => s.name))] });
    loadStudents(); loadSection();
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
