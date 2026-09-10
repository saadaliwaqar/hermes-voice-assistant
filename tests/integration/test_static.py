from fastapi.testclient import TestClient

from hermes_voice.server import create_app


def test_html_asset_urls_are_served_with_browser_mime_types(tmp_path):
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1") as client:
        page = client.get("/")
        assert page.status_code == 200
        for filename, content_type in [
            ("style.css", "text/css"),
            ("app.mjs", "javascript"),
            ("voice-core.mjs", "javascript"),
            ("capture-worklet.js", "javascript"),
        ]:
            response = client.get("/static/" + filename)
            assert response.status_code == 200, filename
            assert content_type in response.headers["content-type"], filename
