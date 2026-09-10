import time

from fastapi.testclient import TestClient

from hermes_voice.server import create_app


class FailingAdapter:
    def run(self, *args):
        raise RuntimeError("provider request included TEST_SECRET_DO_NOT_EXPOSE")


def test_chat_failure_is_visible_without_provider_exception_body(tmp_path):
    with TestClient(create_app(tmp_path, FailingAdapter()), base_url="http://127.0.0.1") as client:
        headers = {"X-Hermes-Voice": "browser"}
        sid = client.post("/api/sessions", headers=headers, json={}).json()["id"]
        client.post(f"/api/sessions/{sid}/messages", headers=headers, json={"text": "hello"})
        for _ in range(100):
            detail = client.get(f"/api/sessions/{sid}").json()
            if detail["tasks"] and detail["tasks"][-1]["status"] == "failed":
                break
            time.sleep(0.01)
        assert "TEST_SECRET_DO_NOT_EXPOSE" not in str(detail)
        assert any(
            m["role"] == "system" and "failed" in m["content"].lower() for m in detail["messages"]
        )
