import os, socket, time
import psutil, requests

API = os.getenv("API_URL", "http://localhost:8000")
KEY = os.environ["AGENT_API_KEY"]
HOST = os.getenv("AGENT_HOST", socket.gethostname())
INTERVAL = int(os.getenv("INTERVAL", "30"))
DISK_PATH = os.getenv("DISK_PATH", "C:\\" if os.name == "nt" else "/")
# Optional service checks, e.g. CHECK_SERVICES=web=localhost:3000,api=localhost:8000
SERVICES = [s for s in os.getenv("CHECK_SERVICES", "").split(",") if s]


def port_open(addr: str) -> bool:
    host, port = addr.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(port)), timeout=3):
            return True
    except OSError:
        return False


def collect() -> dict:
    services = {}
    for s in SERVICES:
        name, addr = s.split("=", 1)
        services[name] = port_open(addr)
    return {
        "host": HOST,
        "cpu": psutil.cpu_percent(interval=1),
        "memory": psutil.virtual_memory().percent,
        "disk": psutil.disk_usage(DISK_PATH).percent,
        "uptime_s": int(time.time() - psutil.boot_time()),
        "services": services,
    }


while True:
    try:
        r = requests.post(f"{API}/metrics", json=collect(),
                          headers={"X-API-Key": KEY}, timeout=10)
        print(r.status_code, r.text[:80])
    except Exception as e:
        print("send failed:", e)
    time.sleep(INTERVAL)