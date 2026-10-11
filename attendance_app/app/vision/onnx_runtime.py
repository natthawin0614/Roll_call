"""Create ONNX Runtime sessions on the GPU when possible, otherwise on the CPU."""
import os

import onnxruntime as ort

GPU_PROVIDERS = ["CUDAExecutionProvider", "DmlExecutionProvider"]


def pick_providers(device="auto"):
    available = ort.get_available_providers()
    if device in ("auto", "gpu"):
        for provider in GPU_PROVIDERS:
            if provider in available:
                return [provider, "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def load_session(path, device="auto"):
    if not path.exists():
        raise FileNotFoundError(f"model file not found: {path} (see README: download models)")
    options = ort.SessionOptions()
    options.log_severity_level = 3
    # 4 models run one after another: idle threads must sleep instead of spinning,
    # otherwise the thread pools fight for the CPU and everything becomes ~100x slower
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    threads = int(os.environ.get("OMP_NUM_THREADS", "0"))
    if threads > 0:
        options.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), sess_options=options, providers=pick_providers(device))
