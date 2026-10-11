// Settings: thresholds (saved as overrides of config.yaml), model status, feedback export, wipe all data.

renderNav("settings");
$("#fb").innerHTML = `${ICONS.download} ดาวน์โหลดชุดข้อมูล (zip)`;

// label, help, input type, [min, max, step]
const FIELDS = {
  antispoof: {
    title: "Anti-spoof (กันภาพปลอม)",
    mode: ["โหมด", "block = ไม่เช็คชื่อถ้าสงสัยปลอม · warn = เช็คชื่อแต่ติดธงในรายงาน · off = ปิดทั้ง 3 ชั้น", "select", ["block", "warn", "off"]],
    device_check: ["ชั้น 1: ตรวจมือถือ/จอ/รูปพิมพ์ (YOLO26n)", "หน้าอยู่ในกรอบอุปกรณ์ = ปลอมทันที", "bool"],
    device_conf: ["ความมั่นใจขั้นต่ำของ YOLO26n", "ต่ำลง = จับอุปกรณ์ง่ายขึ้น", "range", [0.25, 0.95, 0.05]],
    live_below: ["ชั้น 2: P(spoof) ต่ำกว่านี้ = คนจริง", "ผ่านทันที ไม่ต้องหันหน้า", "range", [0.01, 0.6, 0.01]],
    spoof_above: ["ชั้น 2: P(spoof) สูงกว่านี้ = ปลอม", "ระหว่างสองค่านี้ = ให้หันหน้า (ชั้น 3)", "range", [0.4, 0.99, 0.01]],
    average_frames: ["เฉลี่ย P(spoof) กี่เฟรม", "", "number", [1, 20, 1]],
    challenge: ["ชั้น 3: ให้หันหน้าเมื่อไม่แน่ใจ", "ปิด = ตัดสินด้วยค่ากลางของชั้น 2", "bool"],
    challenge_yaw: ["ต้องหันมากแค่ไหน", "0.3 ≈ 20 องศา", "range", [0.15, 0.8, 0.05]],
    challenge_timeout_sec: ["เวลาให้หัน (วินาที)", "", "number", [2, 20, 1]],
    challenge_tries: ["ให้ลองได้กี่ครั้ง", "ไม่ผ่านครบจำนวนนี้ = ปลอม", "number", [1, 5, 1]],
  },
  matching: {
    title: "การจดจำใบหน้า",
    sim_threshold: ["ความเหมือนขั้นต่ำ", "cosine similarity ที่ถือว่าเป็นคนเดียวกัน (ArcFace: คนเดียวกันมัก 0.45+)", "range", [0.2, 0.8, 0.01]],
    min_margin: ["ระยะห่างอันดับ 1–2", "คะแนนอันดับ 1 ต้องห่างจากคนถัดไปอย่างน้อยเท่านี้", "range", [0, 0.3, 0.01]],
    risk_sim_threshold: ["ความเหมือนขั้นต่ำ (กลุ่มเสี่ยง)", "สำหรับแฝด/หน้าคล้าย ควรสูงกว่าค่าปกติ", "range", [0.3, 0.9, 0.01]],
    risk_margin: ["ระยะห่างอันดับ 1–2 (กลุ่มเสี่ยง)", "ถ้าไม่ถึง ระบบจะถามอาจารย์แทนการเช็คอัตโนมัติ", "range", [0, 0.4, 0.01]],
    pair_check: ["ตัวแยกแฝด (Fisher)", "เทียบเฉพาะคู่แฝดด้วยทิศทางที่แยกสองคนออกจากกันได้ดีที่สุด", "bool"],
    pair_min_photos: ["รูปขั้นต่ำต่อคนสำหรับตัวแยกแฝด", "", "number", [2, 10, 1]],
    pair_min_confidence: ["ความมั่นใจขั้นต่ำของตัวแยกแฝด", "หน่วยเป็นส่วนเบี่ยงเบนมาตรฐาน (สูง = เข้มขึ้น)", "range", [0, 3, 0.1]],
  },
  attendance: {
    title: "การเช็คชื่อ",
    confirm_frames: ["จำนวนเฟรมยืนยัน (N)", "ต้องเป็นคนจริง + คนเดิมต่อเนื่องกี่เฟรมจึงเช็คชื่อ", "number", [1, 30, 1]],
    spoof_frames: ["จำนวนเฟรมก่อนสรุปว่าปลอม (เจออุปกรณ์)", "เห็นมือถือ/จอ/รูปพิมพ์ติดกันกี่เฟรมจึงสรุปว่าปลอม", "number", [1, 30, 1]],
    ambiguous_frames: ["จำนวนเฟรมก่อนถามอาจารย์", "ไม่แน่ใจต่อเนื่องกี่เฟรมจึงขึ้น popup ยืนยันตัวตน", "number", [2, 40, 1]],
    late_minutes: ["สายเมื่อเกิน (นาที) ค่าเริ่มต้น", "ใช้กับห้องที่สร้างใหม่", "number", [0, 180, 1]],
    evidence_cooldown_sec: ["เว้นระยะเก็บหลักฐาน (วินาที)", "กันเก็บภาพซ้ำจากหน้าเดิม", "number", [1, 300, 1]],
    min_face_px: ["ขนาดหน้าขั้นต่ำในกล้อง (px)", "หน้าที่เล็กกว่านี้จะไม่ถูกประมวลผล", "number", [20, 400, 5]],
    max_yaw: ["หันซ้าย-ขวาได้สูงสุด (ด่านคุณภาพ)", "เกินนี้ = ขึ้นว่า มองตรงที่กล้อง และยังไม่ตัดสิน", "range", [0.1, 1, 0.05]],
    max_pitch: ["ก้ม-เงยได้สูงสุด (ด่านคุณภาพ)", "", "range", [0.1, 1, 0.05]],
  },
  enroll: {
    title: "รูปอ้างอิงตอนเพิ่มนักศึกษา",
    similar_warn: ["เกณฑ์เตือนแฝด/หน้าคล้าย", "สองคนที่ similarity เกินนี้จะถูกจัดเข้ากลุ่มเสี่ยงอัตโนมัติ", "range", [0.2, 0.8, 0.01]],
    min_face_px: ["ขนาดหน้าขั้นต่ำ (px)", "", "number", [20, 600, 5]],
    min_sharpness: ["ความคมขั้นต่ำ", "ต่ำกว่านี้ = เตือนว่าเบลอ", "number", [0, 500, 5]],
    max_yaw: ["หันซ้าย-ขวาได้สูงสุด", "0 = หน้าตรง", "range", [0.1, 1, 0.05]],
    max_pitch: ["ก้ม-เงยได้สูงสุด", "", "range", [0.1, 1, 0.05]],
    max_photos: ["รูปสูงสุดต่อคน", "", "number", [1, 20, 1]],
  },
};

let state = null;

function inputHtml(group, key, value, spec) {
  const [, , type, opt] = spec;
  const id = `${group}.${key}`;
  if (type === "select") return `<select class="input" data-k="${id}">${opt.map((o) => `<option ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  if (type === "bool") return `<label class="check"><input type="checkbox" data-k="${id}" ${value ? "checked" : ""}> เปิดใช้</label>`;
  if (type === "range") return `<div class="row" style="flex-wrap:nowrap"><input type="range" data-k="${id}" min="${opt[0]}" max="${opt[1]}" step="${opt[2]}" value="${value}">
    <b class="gold" data-v="${id}" style="min-width:44px;text-align:right">${value}</b></div>`;
  return `<input class="input" type="number" data-k="${id}" min="${opt[0]}" max="${opt[1]}" step="${opt[2]}" value="${value}">`;
}

async function load(data) {
  state = data || await api("/api/settings");
  $("#groups").innerHTML = `
    <section class="card row between">
      <div><h3>สถานะโมเดล</h3><p class="muted small" style="margin:4px 0 0">ประมวลผลด้วย <b class="gold">${state.device}</b> (${state.providers.join(", ")})</p></div>
      <div class="small muted">${Object.entries(state.models).map(([k, v]) => `<div>${k}: <code>${esc(v)}</code></div>`).join("")}</div>
    </section>` +
    Object.entries(FIELDS).map(([group, fields]) => `
    <section class="card">
      <h3>${fields.title}</h3>
      ${Object.entries(fields).filter(([k]) => k !== "title").map(([key, spec]) => {
        const value = state.values[group][key], def = state.defaults[group][key];
        return `<div class="setting"><div><div>${spec[0]} ${value !== def ? `<span class="changed">· แก้แล้ว (เดิม ${def})</span>` : ""}</div>
          <div class="help">${spec[1]}</div></div><div>${inputHtml(group, key, value, spec)}</div></div>`;
      }).join("")}
    </section>`).join("");
  $$("input[type=range]").forEach((r) => r.addEventListener("input", () => { $(`[data-v="${r.dataset.k}"]`).textContent = r.value; }));
}

$("#save").onclick = async () => {
  const body = {};
  $$("[data-k]").forEach((el) => {
    const [group, key] = el.dataset.k.split(".");
    body[group] = body[group] || {};
    body[group][key] = el.type === "checkbox" ? el.checked : el.value;
  });
  await load(await api("/api/settings", { method: "PUT", json: body }));
  toast("บันทึกการตั้งค่าแล้ว มีผลทันที");
};

$("#reset").onclick = async () => {
  if (!(await confirmBox("คืนค่าเริ่มต้น?", "ค่าที่แก้ในหน้านี้ทั้งหมดจะกลับไปเป็นค่าใน config.yaml"))) return;
  await load(await api("/api/settings/reset", { method: "POST" }));
  toast("คืนค่าเริ่มต้นแล้ว");
};

$("#wipe").onclick = () => {
  const m = openModal(`<div class="modal-head"><h3 style="color:var(--bad)">ลบข้อมูลทั้งหมด</h3></div>
    <p>ห้องเรียน นักศึกษา รูปใบหน้า embedding ประวัติการเช็คชื่อ ภาพหลักฐาน และไฟล์ Excel ทั้งหมดจะถูกลบถาวร</p>
    <label class="field">พิมพ์คำว่า <b>ลบทั้งหมด</b> เพื่อยืนยัน<input class="input" id="cf"></label>
    <div class="modal-foot"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn danger" id="ok">ลบถาวร</button></div>`);
  $("#ok", m.el).onclick = async () => {
    await api("/api/data/wipe", { method: "POST", json: { confirm: $("#cf", m.el).value.trim() } });
    m.close();
    toast("ลบข้อมูลทั้งหมดแล้ว");
  };
};

load();
