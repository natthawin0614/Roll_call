# Roll Call — ระบบเช็คชื่อนักศึกษาด้วยใบหน้า

เว็บแอปเช็คชื่อด้วยกล้อง + กันภาพปลอม 3 ชั้น (YOLO26n ตรวจมือถือ/จอ, ConvNeXt, ให้หันหน้าเมื่อไม่แน่ใจ) — ทำงานในเครื่อง ไม่ส่งข้อมูลออกอินเทอร์เน็ต

```
Roll_call/
├─ attendance_app/   เว็บแอป (FastAPI + ONNX Runtime) — คู่มือเต็ม: attendance_app/README.md
├─ notebook/         Colab notebooks ที่ใช้เทรนโมเดล
│   ├─ 01_yolo_face_widerface.ipynb   YOLO26s หาหน้า (WIDER FACE)
│   ├─ 02_antispoof_colab.ipynb       ConvNeXt / MobileNetV3 / EfficientNet กันภาพปลอม (CelebA-Spoof)
│   └─ 03_spoof_detector_colab.ipynb  YOLO26n ตรวจมือถือ/จอ/รูปพิมพ์ (Roboflow) + fine-tune ConvNeXt
└─ roll_call/        (ไม่อยู่ใน git) ผลเทรน/โมเดลจาก Google Drive
```

## ติดตั้งและรัน (Windows, Python 3.11–3.12)
1. **โค้ด**
   ```powershell
   git clone https://github.com/natthawin0614/Roll_call.git
   cd Roll_call\attendance_app
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. **โมเดล** — ดาวน์โหลดจาก Google Drive:
   https://drive.google.com/drive/folders/1ASkYBfjdvK459_E2b0ZL_uukRwH8Xd9i
   ต้องใช้แค่โฟลเดอร์ `export` 3 ที่ (ไม่ต้องโหลด runs / cache ที่ใหญ่) วางให้โครงสร้างเป็นแบบนี้:
   ```
   Roll_call\roll_call\yolo_face\yolo26s_widerface_960\export\yolo26s_widerface_960_best_640.onnx
   Roll_call\roll_call\antispoof\export\antispoof_convnext_aug_ema.onnx  + antispoof_config.json
   Roll_call\roll_call\spoof_yolo\export\spoof_yolo26n_640.onnx  + antispoof_convnext_ft.onnx + spoof_config.json
   ```
   แล้วรัน (คัดลอกเข้า `attendance_app\models\` และโหลด InsightFace buffalo_l ให้เอง):
   ```powershell
   python scripts\setup_models.py
   ```
3. **รัน**
   ```powershell
   python run.py            # เปิด http://localhost:8000
   python run.py --https    # ถ้าจะเปิดจากแท็บเล็ต/มือถือ (กล้องต้องใช้ https)
   ```
4. สร้างห้อง → เพิ่มนักศึกษา + รูป (หรือ "นำเข้าจากโฟลเดอร์" ที่ตั้งชื่อไฟล์ = ชื่อนักศึกษา) → เริ่มเช็คชื่อ

ทดสอบกับรูป/วิดีโอของตัวเองเทียบเฉลย Excel: `python scripts\run_test.py "โฟลเดอร์"` (ดู attendance_app/README.md หัวข้อ 5.1)

## ข้อมูลส่วนบุคคล
รูปหน้าและฐานข้อมูล (`image_pyiot/`, `attendance_app/data/`, `test_results/`) ถูกกันไว้ใน `.gitignore` — อย่าอัปรูปเพื่อนขึ้น repo สาธารณะ

## License / เครดิต
- ArcFace R50 + SCRFD (InsightFace buffalo_l): ใช้ได้เฉพาะงานวิจัย/การศึกษา (non-commercial)
- Roboflow *face anti spoofing detection* (WeiJers Workspace, CC BY 4.0) · Axon Labs Replay Mobile sample (CC BY-NC 4.0) · CelebA-Spoof · WIDER FACE
