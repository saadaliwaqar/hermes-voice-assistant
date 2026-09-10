import time

from fastapi.testclient import TestClient

from hermes_voice.server import create_app

H = {"X-Hermes-Voice": "browser"}


class Fake:
    def run(self, text, history, worker, settings, job, ask):
        if worker:
            while not job.cancelled.wait(0.02):
                if text == "approve":
                    return "allowed" if ask("approval", {"command": "test"}) is True else "denied"
        return "reply:" + text + ":" + str(len(history))


def wait(client, sid, status):
    for _ in range(100):
        data = client.get("/api/sessions/" + sid).json()
        if data["tasks"][-1]["status"] == status:
            return data
        time.sleep(0.02)
    raise AssertionError(data)


def test_security_persistence_isolation(tmp_path):
    app = create_app(tmp_path, Fake())
    with TestClient(app, base_url="http://127.0.0.1") as c:
        assert c.post("/api/sessions", json={}).status_code == 403
        assert (
            c.post(
                "/api/sessions", json={}, headers={**H, "Origin": "https://evil.test"}
            ).status_code
            == 403
        )
        a = c.post("/api/sessions", json={}, headers=H).json()["id"]
        b = c.post("/api/sessions", json={}, headers=H).json()["id"]
        assert (
            c.post(
                "/api/sessions/" + a + "/messages", json={"text": "hello"}, headers=H
            ).status_code
            == 202
        )
        assert wait(c, a, "completed")["messages"][-1]["content"] == "reply:hello:0"
        assert c.get("/api/sessions/" + b).json()["messages"] == []
        assert c.patch("/api/settings", json={"api_key": "secret"}, headers=H).status_code == 422
    with TestClient(create_app(tmp_path, Fake()), base_url="http://127.0.0.1") as c:
        assert len(c.get("/api/sessions/" + a).json()["messages"]) == 2


def test_worker_survives_polling_chat_and_cancel(tmp_path):
    with TestClient(create_app(tmp_path, Fake()), base_url="http://127.0.0.1") as c:
        sid = c.post("/api/sessions", json={}, headers=H).json()["id"]
        url = "/api/sessions/" + sid
        task = c.post(url + "/messages", json={"text": "work", "worker": True}, headers=H).json()[
            "id"
        ]
        assert (
            c.post(url + "/messages", json={"text": "again", "worker": True}, headers=H).status_code
            == 409
        )
        assert c.delete(url, headers=H).status_code == 409
        assert c.post(url + "/messages", json={"text": "chat"}, headers=H).status_code == 202
        c.post(url + "/stop", headers=H)
        assert c.get(url).json()["tasks"][0]["status"] == "running"
        c.post("/api/tasks/" + task + "/cancel", headers=H)
        for _ in range(100):
            data = c.get(url).json()
            if data["tasks"][0]["status"] == "cancelled":
                break
            time.sleep(0.02)
        assert data["tasks"][0]["status"] == "cancelled"


def test_approval_is_one_shot(tmp_path):
    with TestClient(create_app(tmp_path, Fake()), base_url="http://127.0.0.1") as c:
        sid = c.post("/api/sessions", json={}, headers=H).json()["id"]
        c.post(
            "/api/sessions/" + sid + "/messages",
            json={"text": "approve", "worker": True},
            headers=H,
        )
        for _ in range(100):
            approvals = c.get("/api/sessions/" + sid).json()["approvals"]
            if approvals:
                break
            time.sleep(0.02)
        url = "/api/approvals/" + approvals[0]["id"]
        assert c.post(url, json={"approved": False}, headers=H).status_code == 200
        assert c.post(url, json={"approved": True}, headers=H).status_code == 409
        assert wait(c, sid, "completed")["messages"][-1]["content"] == "denied"
