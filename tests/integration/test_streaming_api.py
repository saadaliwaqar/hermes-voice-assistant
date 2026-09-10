import threading
import time

import pytest
from fastapi.testclient import TestClient

from hermes_voice.server import create_app

H = {"X-Hermes-Voice": "browser"}


class Controlled:
    def __init__(self, fail=False):
        self.ready = threading.Event()
        self.release = threading.Event()
        self.calls = 0
        self.fail = fail

    def run(self, text, history, worker, settings, job, ask):
        self.calls += 1
        self.job = job
        job.emit_text(None)
        job.emit_text({"reasoning": "never expose"})
        job.emit_text("Early sentence. ")
        self.ready.set()
        assert self.release.wait(5)
        job.emit_text("Final sentence.")
        if self.fail:
            raise RuntimeError("SECRET-provider-exception")
        return "Early sentence. Final sentence."


def settled(c, url):
    for _ in range(100):
        data = c.get(url).json()
        if data["tasks"][-1]["status"] not in ("running", "cancelling"):
            return data
        time.sleep(0.01)
    raise AssertionError("job never settled")


@pytest.mark.parametrize("mode", ["complete", "cancel", "fail", "worker", "default"])
def test_partial_is_ephemeral_scoped_and_final_once(tmp_path, mode):
    adapter = Controlled(fail=mode == "fail")
    app = create_app(tmp_path, adapter)
    with TestClient(app, base_url="http://127.0.0.1") as c:
        sid = c.post("/api/sessions", headers=H, json={}).json()["id"]
        other = c.post("/api/sessions", headers=H, json={}).json()["id"]
        url = "/api/sessions/" + sid
        payload = {"text": "hi", "worker": mode == "worker"}
        if mode != "default":
            payload["stream"] = True
        response = c.post(url + "/messages", headers=H, json=payload)
        assert response.status_code == 202
        assert adapter.ready.wait(2)
        try:
            data = c.get(url).json()
            assert len(data["messages"]) == 1
            assert c.get("/api/sessions/" + other).json()["streams"] == []
            if mode in ("worker", "default"):
                assert data["streams"] == []
            else:
                assert data["streams"] == [
                    {
                        "task_id": response.json()["id"],
                        "session_id": sid,
                        "text": "Early sentence. ",
                        "revision": 1,
                    }
                ]
            if mode == "cancel":
                assert c.post(url + "/stop", headers=H).status_code == 200
                adapter.job.emit_text("late")
                assert c.get(url).json()["streams"] == []
        finally:
            adapter.release.set()
        data = settled(c, url)
        assert data["streams"] == []
        assert "SECRET" not in str(data) and "never expose" not in str(data)
        replies = [m for m in data["messages"] if m["role"] == "assistant"]
        if mode in ("cancel", "fail"):
            assert replies == []
        else:
            assert [m["content"] for m in replies] == ["Early sentence. Final sentence."]
            assert data["tasks"][-1]["result"] == replies[0]["content"]
            assert len(app.state.store.history(sid, "worker" if mode == "worker" else "chat")) == 2
        assert adapter.calls == 1
        adapter.job.emit_text("late after done")
        assert c.get(url).json()["streams"] == []
    with TestClient(create_app(tmp_path, adapter), base_url="http://127.0.0.1") as c:
        assert c.get(url).json()["streams"] == []
