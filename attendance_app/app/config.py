"""Load config.yaml and merge the overrides saved from the Settings page."""
import copy
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / "config.yaml"

# Settings that the teacher may edit on the Settings page: (section, key)
EDITABLE = {
    "antispoof": ["mode", "device_check", "device_conf", "live_below", "spoof_above", "average_frames",
                  "challenge", "challenge_yaw", "challenge_timeout_sec", "challenge_tries"],
    "matching": ["sim_threshold", "min_margin", "risk_sim_threshold", "risk_margin",
                 "pair_check", "pair_min_photos", "pair_min_confidence"],
    "enroll": ["similar_warn", "min_face_px", "min_sharpness", "max_yaw", "max_pitch", "max_photos"],
    "attendance": ["confirm_frames", "spoof_frames", "ambiguous_frames", "late_minutes",
                   "evidence_cooldown_sec", "min_face_px", "max_yaw", "max_pitch"],
}


def _deep_merge(base, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


class Config:
    def __init__(self):
        self.defaults = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8"))
        self.data_dir = (ROOT / self.defaults["paths"]["data_dir"]).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.override_file = self.data_dir / "settings.yaml"
        self.reload()

    def reload(self):
        self.values = copy.deepcopy(self.defaults)
        if self.override_file.exists():
            _deep_merge(self.values, yaml.safe_load(self.override_file.read_text(encoding="utf-8")) or {})

    def __getitem__(self, section):
        return self.values[section]

    def path(self, relative):
        """Resolve a path written in config.yaml (relative to the project root)."""
        return (ROOT / relative).resolve()

    def editable(self):
        return {s: {k: self.values[s][k] for k in keys} for s, keys in EDITABLE.items()}

    def save_overrides(self, changes):
        """Save edited thresholds; values equal to config.yaml are dropped."""
        overrides = {}
        for section, keys in EDITABLE.items():
            for key in keys:
                if key in changes.get(section, {}):
                    default, value = self.defaults[section][key], changes[section][key]
                    if isinstance(default, bool):
                        value = value in (True, 1, "1", "true", "on")
                    else:
                        value = type(default)(value)
                    if value != self.defaults[section][key]:
                        overrides.setdefault(section, {})[key] = value
        self.override_file.write_text(yaml.safe_dump(overrides, allow_unicode=True), encoding="utf-8")
        self.reload()

    def reset_overrides(self):
        self.override_file.unlink(missing_ok=True)
        self.reload()


config = Config()
