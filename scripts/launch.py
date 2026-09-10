"""Manual local development launcher. No services or startup installation."""

import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8780"


def health():
    try:
        with urllib.request.urlopen(URL + "/api/health", timeout=1) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def launch_environment(root, environment):
    env = dict(environment)
    env.setdefault("HERMES_VOICE_DATA_DIR", str(root / ".local" / "app"))
    models = root / ".local" / "piper-voices"
    if models.is_dir():
        env.setdefault("HERMES_VOICE_PIPER_DIR", str(models))
    return env


def main():
    existing = health()
    if existing:
        if existing.get("service") != "hermes-voice":
            print("Port 8780 belongs to another application.")
            return 1
        webbrowser.open(URL)
        print("Hermes Voice is already running. Its original launcher owns shutdown.")
        return 0
    env = launch_environment(ROOT, os.environ)
    child = subprocess.Popen([sys.executable, "-m", "hermes_voice.server"], env=env, cwd=ROOT)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if child.poll() is not None:
                print(
                    "Startup failed. Use a Hermes-enabled Python environment and install this project."
                )
                return child.returncode or 1
            status = health()
            if status and status.get("service") == "hermes-voice":
                print("Hermes Voice Assistant by Devsdroid.com: " + URL, flush=True)
                print(
                    "Keep this Terminal open. Control+C stops the server. Mic starts only on your click.",
                    flush=True,
                )
                webbrowser.open(URL)
                return child.wait()
            time.sleep(0.2)
        print("Startup timed out.")
        return 1
    except KeyboardInterrupt:
        print("Stopping Hermes Voice.")
        return 0
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
