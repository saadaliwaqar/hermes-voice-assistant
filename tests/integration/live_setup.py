"""Opt-in real setup check; sends a fixed prompt to the configured model provider."""

import os
import time

import httpx


def main():
    base = os.environ.get("HERMES_VOICE_TEST_URL", "http://127.0.0.1:8781")
    with httpx.Client(
        base_url=base,
        timeout=90,
        headers={
            "X-Hermes-Voice": "browser",
            "Origin": base,
        },
    ) as client:
        before = client.get("/api/settings").json()
        sessions = client.get("/api/sessions").json()
        setup = client.get("/api/setup")
        setup.raise_for_status()
        for check in setup.json()["checks"]:
            print(check["id"], check["status"], check["detail"])
        assert client.get("/api/settings").json() == before
        start = time.monotonic()
        response = client.post(
            "/api/setup/test-model",
            json={
                "model": before.get("fast_model") or before["model"],
                "provider": before["provider"],
            },
        )
        response.raise_for_status()
        result = response.json()
        assert result["ok"] is True, result
        assert client.get("/api/settings").json() == before
        assert client.get("/api/sessions").json() == sessions
        print(
            "LIVE_SETUP_MODEL_PASS",
            round(time.monotonic() - start, 2),
            "seconds",
            result["message"],
        )
        print("SETUP_SETTINGS_AND_SESSION_ISOLATION_PASS")


if __name__ == "__main__":
    main()
