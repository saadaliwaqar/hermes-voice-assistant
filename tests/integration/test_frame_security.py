from fastapi.testclient import TestClient

from hermes_voice.server import create_app


def test_dashboard_prohibits_framing_without_relying_on_origin_header(tmp_path):
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1") as client:
        response = client.get(
            "/", headers={"Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "cross-site"}
        )
        assert response.status_code == 200
        assert response.headers.get("Content-Security-Policy") == "frame-ancestors 'none'"
        assert response.headers.get("X-Frame-Options") == "DENY"
