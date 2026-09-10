"""Opt-in live-provider alpha checks. Requires a running local server.
Creates isolated QA sessions and local .local fixtures; never runs in default CI.
Uses the configured real providers and can consume API credits.
"""

import json
import os
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("HERMES_VOICE_TEST_URL", "http://127.0.0.1:8780")


def run():
    client = httpx.Client(
        base_url=BASE, headers={"X-Hermes-Voice": "browser", "Origin": BASE}, timeout=15
    )
    evidence = {"checks": [], "sessions": [], "passed": False}

    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()

    def until(fn, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = fn()
            if result:
                return result
            time.sleep(0.35)
        raise AssertionError("Timed out waiting for expected live state")

    def state(sid):
        return request("GET", f"/api/sessions/{sid}")

    def assistant_after(sid, count):
        data = state(sid)
        messages = [m for m in data["messages"] if m["role"] == "assistant"]
        return messages[-1] if len(messages) > count else None

    try:
        health = request("GET", "/api/health")
        assert health["hermes_available"], health
        evidence["health"] = health
        a = request("POST", "/api/sessions", json={"title": "QA background research"})["id"]
        b = request("POST", "/api/sessions", json={"title": "QA separate conversation"})["id"]
        evidence["sessions"] = [a, b]
        nonce = "cedar-" + uuid.uuid4().hex[:8]
        request(
            "POST",
            f"/api/sessions/{a}/messages",
            json={
                "text": f"Remember this session code: {nonce}. Reply with that code only.",
                "worker": False,
            },
        )
        assert nonce in until(lambda: assistant_after(a, 0))["content"]
        request(
            "POST",
            f"/api/sessions/{b}/messages",
            json={
                "text": "Has anyone given you a session code in this conversation? Say NO if not. Do not invent a code.",
                "worker": False,
            },
        )
        other = until(lambda: assistant_after(b, 0))["content"]
        assert nonce not in other and "no" in other.lower(), other
        evidence["checks"].append("live session context isolation")
        fixture = ROOT / ".local" / "qa-worker-input.txt"
        fixture.parent.mkdir(exist_ok=True)
        fixture.write_text("actual-worker-evidence-" + nonce, encoding="utf8")
        brief = (
            f"Use the terminal tool to run a Python command that waits 12 seconds, then reads {fixture} and prints its exact contents. "
            "Do not modify files. Report only the actual read contents. This is an authorized local test."
        )
        request("POST", f"/api/sessions/{a}/messages", json={"text": brief, "worker": True})
        task = until(
            lambda: next(
                (t for t in state(a)["tasks"] if t["status"] in {"running", "queued"}),
                None,
            )
        )
        request(
            "POST",
            f"/api/sessions/{b}/messages",
            json={
                "text": "Tell me one short robot joke, one sentence.",
                "worker": False,
            },
        )
        until(lambda: assistant_after(b, 1))
        assert any(
            t["id"] == task["id"] and t["status"] in {"running", "queued"}
            for t in state(a)["tasks"]
        ), "Worker finished before overlapping chat; test inconclusive"
        evidence["checks"].append("real conversation in B while worker in A remains active")
        # Drop HTTP client, reconnect to same persisted session without resubmitting.
        client.close()
        client = httpx.Client(
            base_url=BASE,
            headers={"X-Hermes-Voice": "browser", "Origin": BASE},
            timeout=15,
        )
        done = until(
            lambda: next(
                (
                    t
                    for t in state(a)["tasks"]
                    if t["id"] == task["id"]
                    and t["status"] not in {"queued", "running", "cancelling"}
                ),
                None,
            ),
            180,
        )
        assert "actual-worker-evidence-" + nonce in str(done.get("result", "")), done
        assert len([t for t in state(a)["tasks"] if t["id"] == task["id"]]) == 1
        evidence["checks"].append("worker survives client reconnect; one actual read result")
        request(
            "POST",
            f"/api/sessions/{b}/messages",
            json={
                "text": "Use terminal to wait 20 seconds, then report done. Do not modify files.",
                "worker": True,
            },
        )
        cancel = until(
            lambda: next(
                (t for t in state(b)["tasks"] if t["status"] in {"queued", "running"}),
                None,
            )
        )
        request("POST", f"/api/tasks/{cancel['id']}/cancel", json={})
        stopped = until(
            lambda: next(
                (
                    t
                    for t in state(b)["tasks"]
                    if t["id"] == cancel["id"]
                    and t["status"] in {"cancelled", "interrupted", "failed"}
                ),
                None,
            )
        )
        assert stopped["status"] == "cancelled", stopped
        evidence["checks"].append("cooperative worker cancellation")
        export = request("GET", f"/api/sessions/{a}/export")
        assert nonce in json.dumps(export)
        evidence["checks"].append("session export contains actual conversation")
        assert (
            client.post(
                "/api/sessions",
                json={"title": "not allowed"},
                headers={"Origin": "https://evil.example"},
            ).status_code
            == 403
        )
        evidence["checks"].append("foreign Origin mutation rejected")
        evidence["passed"] = True
        print(json.dumps(evidence, indent=2))
    finally:
        (ROOT / ".local").mkdir(exist_ok=True)
        (ROOT / ".local" / "live-api-results.json").write_text(
            json.dumps(evidence, indent=2), encoding="utf8"
        )
        client.close()


if __name__ == "__main__":
    run()
