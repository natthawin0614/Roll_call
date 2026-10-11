"""Start the roll-call web app:   python run.py   (then open the printed address)

    python run.py --https     self-signed HTTPS, needed when the camera is on another device (tablet)
    python run.py --lan       listen on the local network (0.0.0.0)
"""
import socket
import sys
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path

import uvicorn

from app.config import config

ROOT = Path(__file__).resolve().parent


def make_self_signed_cert(folder):
    """Create cert.pem / key.pem once (for HTTPS on the LAN)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    cert_file, key_file = folder / "cert.pem", folder / "key.pem"
    if cert_file.exists() and key_file.exists():
        return cert_file, key_file
    folder.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "roll-call.local")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
            .not_valid_after(datetime.now(timezone.utc) + timedelta(days=3650))
            .sign(key, hashes.SHA256()))
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                           serialization.NoEncryption()))
    return cert_file, key_file


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    server = config["server"]
    host = "0.0.0.0" if "--lan" in sys.argv or "--https" in sys.argv else server["host"]
    https = server["https"] or "--https" in sys.argv
    ssl = {}
    if https:
        cert, key = make_self_signed_cert(config.data_dir / "certs")
        ssl = {"ssl_certfile": str(cert), "ssl_keyfile": str(key)}

    scheme = "https" if https else "http"
    local_url = f"{scheme}://localhost:{server['port']}"
    print("\n  ระบบเช็คชื่อด้วยใบหน้า")
    print(f"  เปิดในเครื่องนี้ : {local_url}")
    if host == "0.0.0.0":
        print(f"  เปิดจากเครื่องอื่น: {scheme}://{lan_ip()}:{server['port']}")
    print()
    if "--no-browser" not in sys.argv:
        webbrowser.open(local_url)
    uvicorn.run("app.main:app", host=host, port=server["port"], log_level="warning", **ssl)
