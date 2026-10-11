"""SQLite database (SQLAlchemy). Everything stays in data/roll_call.db on this machine."""
from datetime import datetime

import numpy as np
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text,
                        create_engine, event)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from .config import config

engine = create_engine(f"sqlite:///{config.data_dir / 'roll_call.db'}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()


@event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, _):
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def now():
    return datetime.now().replace(microsecond=0)


class Section(Base):
    """One class (course + section + term)."""
    __tablename__ = "sections"
    id = Column(Integer, primary_key=True)
    course_code = Column(String, default="")
    course_name = Column(String, nullable=False)
    section = Column(String, default="")
    term = Column(String, default="")
    start_time = Column(String, default="09:00")       # usual class start, HH:MM
    late_minutes = Column(Integer, default=15)
    created_at = Column(DateTime, default=now)
    students = relationship("Student", back_populates="section_obj", cascade="all, delete-orphan")
    sessions = relationship("ClassSession", back_populates="section_obj", cascade="all, delete-orphan")


class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True)
    section_id = Column(Integer, ForeignKey("sections.id", ondelete="CASCADE"), nullable=False)
    student_code = Column(String, default="")
    name = Column(String, nullable=False)
    risk_group = Column(Boolean, default=False)          # twins / look-alikes: stricter rules
    risk_manual = Column(Boolean, default=False)         # True = teacher set risk_group by hand (keep it)
    consent_at = Column(DateTime)                        # PDPA consent recorded when photos were added
    created_at = Column(DateTime, default=now)
    section_obj = relationship("Section", back_populates="students")
    photos = relationship("FacePhoto", back_populates="student", cascade="all, delete-orphan")


class FacePhoto(Base):
    __tablename__ = "face_photos"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    image_path = Column(String)          # resized original (kept so embeddings can be recomputed)
    face_path = Column(String)           # aligned 112x112 face for display
    embedding = Column(LargeBinary)      # float32[512]
    quality = Column(Text, default="{}")  # json
    warnings = Column(Text, default="[]")  # json list of Thai warnings
    source = Column(String, default="upload")   # upload | import | confirmed (added from a live confirmation)
    created_at = Column(DateTime, default=now)
    student = relationship("Student", back_populates="photos")

    @property
    def vector(self):
        return np.frombuffer(self.embedding, np.float32)


class ClassSession(Base):
    """One class meeting (opened with "เริ่มคาบ", closed with "ปิดคาบ")."""
    __tablename__ = "class_sessions"
    id = Column(Integer, primary_key=True)
    section_id = Column(Integer, ForeignKey("sections.id", ondelete="CASCADE"), nullable=False)
    scheduled_start = Column(DateTime, nullable=False)
    late_minutes = Column(Integer, default=15)
    opened_at = Column(DateTime, default=now)
    closed_at = Column(DateTime)
    note = Column(String, default="")
    section_obj = relationship("Section", back_populates="sessions")
    records = relationship("Attendance", cascade="all, delete-orphan")
    events = relationship("EventLog", cascade="all, delete-orphan")


class Attendance(Base):
    __tablename__ = "attendance"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    checked_at = Column(DateTime, default=now)
    method = Column(String, default="auto")       # auto | manual | confirmed (teacher picked in popup)
    similarity = Column(Float)
    spoof_score = Column(Float)
    flagged = Column(Boolean, default=False)       # anti-spoof in "warn" mode thought it was a spoof
    snapshot_path = Column(String)
    student = relationship("Student")


class EventLog(Base):
    """Spoof evidence, teacher confirmations and manual changes, shown in the report."""
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=False)
    at = Column(DateTime, default=now)
    kind = Column(String)          # spoof | confirm | reject | manual_add | manual_remove
    student_id = Column(Integer, ForeignKey("students.id", ondelete="SET NULL"))
    detail = Column(Text, default="")  # json: scores, candidates, ...
    image_path = Column(String)
    reviewed = Column(String, default="")   # spoof review by the teacher: "" | spoof | live
    student = relationship("Student")


def init_db():
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
