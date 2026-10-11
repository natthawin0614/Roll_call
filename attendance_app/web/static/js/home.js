// Home: list of classes + create / edit a class.

renderNav("home");
$("#new-btn").innerHTML = `${ICONS.plus} สร้างห้องเรียน`;
$("#new-btn").addEventListener("click", () => sectionForm());

async function load() {
  const sections = await api("/api/sections");
  const total = (k) => sections.reduce((a, s) => a + s[k], 0);
  $("#stats").innerHTML = `
    <div class="stat"><b>${sections.length}</b><span>ห้องเรียน</span></div>
    <div class="stat"><b>${total("students")}</b><span>นักศึกษา</span></div>
    <div class="stat"><b>${total("photos")}</b><span>รูปอ้างอิง</span></div>
    <div class="stat"><b>${total("sessions")}</b><span>คาบที่เช็คแล้ว</span></div>
    <div class="stat"><b class="gold">${total("risk")}</b><span>กลุ่มเสี่ยง (แฝด/หน้าคล้าย)</span></div>`;

  const box = $("#sections");
  if (!sections.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <h3 style="margin-bottom:8px">ยังไม่มีห้องเรียน</h3>
      <p>เริ่มจากสร้างห้องเรียน แล้วนำเข้ารูปนักศึกษาจากโฟลเดอร์ได้ในไม่กี่คลิก</p>
      <button class="btn gold" onclick="sectionForm()">${ICONS.plus} สร้างห้องเรียนแรก</button></div>`;
    return;
  }
  box.innerHTML = sections.map((s, i) => `
    <article class="card hover class-card fade-in" style="animation-delay:${i * 50}ms" data-id="${s.id}">
      <div class="row between">
        <span class="code">${esc(s.course_code || "COURSE")} · SEC ${esc(s.section || "-")}</span>
        ${s.open_session ? `<span class="badge ok"><span class="rec"></span> กำลังเช็คชื่อ</span>` : `<span class="badge line">เทอม ${esc(s.term || "-")}</span>`}
      </div>
      <h3>${esc(s.course_name)}</h3>
      <div class="class-meta">
        <span>${s.students} นักศึกษา</span><span>${s.photos} รูป</span><span>เริ่ม ${esc(s.start_time)} น.</span>
        ${s.risk ? `<span class="gold">${s.risk} กลุ่มเสี่ยง</span>` : ""}
      </div>
      ${s.missing_photos ? `<span class="badge warn">${s.missing_photos} คนยังไม่มีรูป</span>` : ""}
      <hr class="divider" style="margin:4px 0">
      <div class="row between">
        <span class="muted small">${s.last_session ? "คาบล่าสุด " + s.last_session : "ยังไม่เคยเช็คชื่อ"}</span>
        <button class="btn gold sm" data-start="${s.id}" data-open="${s.open_session || ""}">${ICONS.camera} ${s.open_session ? "กลับไปเช็คต่อ" : "เริ่มคาบ"}</button>
      </div>
    </article>`).join("");

  $$(".class-card", box).forEach((card) => card.addEventListener("click", (e) => {
    const start = e.target.closest("[data-start]");
    if (start) {
      e.stopPropagation();
      if (start.dataset.open) location.href = `/live.html?session=${start.dataset.open}`;
      else startSessionDialog(sections.find((s) => s.id == start.dataset.start));
      return;
    }
    location.href = `/section.html?id=${card.dataset.id}`;
  }));
}

load();
