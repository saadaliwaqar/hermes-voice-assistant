import mimetypes

import pytest
from fastapi.testclient import TestClient

from hermes_voice.server import create_app


@pytest.mark.parametrize("host_type", ["text/plain", "application/octet-stream"])
@pytest.mark.parametrize("prefix", ["/static/", "/"])
def test_static_mime_types_ignore_host_associations(tmp_path, monkeypatch, host_type, prefix):
    # Windows registry associations can override Python's built-in MIME table.
    mimetypes.init()
    for extension in (".js", ".mjs", ".css", ".html"):
        monkeypatch.setitem(mimetypes.types_map, extension, host_type)
    with TestClient(create_app(tmp_path), base_url="http://127.0.0.1") as client:
        for filename, expected in [
            ("app.mjs", "text/javascript"),
            ("voice-core.mjs", "text/javascript"),
            ("capture-worklet.js", "text/javascript"),
            ("style.css", "text/css"),
            ("index.html", "text/html"),
        ]:
            response = client.get(prefix + filename)
            assert response.status_code == 200, filename
            assert response.headers["content-type"].split(";")[0] == expected, filename
    # Serving the app must not rewrite the process-wide MIME database.
    assert mimetypes.guess_type("app.mjs")[0] == host_type


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
