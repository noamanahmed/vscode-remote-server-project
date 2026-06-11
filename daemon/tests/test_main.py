import os
import json
import base64
import pytest
from fastapi.testclient import TestClient
from fastapi import status, WebSocketDisconnect
from app.main import app
import app.main as main_module


@pytest.fixture(autouse=True)
def setup_auth_token():
    # Set a fixed token for testing
    main_module.auth_token = "test-token"
    yield
    main_module.auth_token = None


@pytest.fixture
def served_root(tmp_path):
    # Point the daemon at a temp directory and create some content.
    (tmp_path / "file.txt").write_text("hello")
    (tmp_path / "subdir").mkdir()
    prev = main_module.state.root
    main_module.state.root = str(tmp_path)
    yield tmp_path
    main_module.state.root = prev


def _rpc(ws, req_id, rtype, payload):
    ws.send_text(json.dumps({"id": req_id, "type": rtype, "payload": payload}))
    return json.loads(ws.receive_text())


def test_read_main_not_found():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 404


def test_websocket_auth_success():
    client = TestClient(app)
    with client.websocket_connect("/ws?token=test-token") as websocket:
        assert True


def test_websocket_auth_failure():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws?token=wrong-token"):
            pass
    assert excinfo.value.code == status.WS_1008_POLICY_VIOLATION


def test_websocket_auth_missing():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws"):
            pass
    assert excinfo.value.code == status.WS_1008_POLICY_VIOLATION


def test_init_and_read_directory(served_root):
    with TestClient(app) as client:  # context manager triggers startup (cache/watchers)
        with client.websocket_connect("/ws?token=test-token") as ws:
            res = _rpc(ws, 1, "init", {})
            assert res["type"] == "init"
            assert res["payload"]["root"] == str(served_root)
            names = {e["name"] for e in res["payload"]["tree"]}
            assert {"file.txt", "subdir"} <= names

            res = _rpc(ws, 2, "readDirectory", {"path": "/"})
            names = {e["name"] for e in res["payload"]["entries"]}
            assert "file.txt" in names


def test_write_read_roundtrip_with_fingerprint(served_root):
    content = base64.b64encode(b"new content").decode()
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=test-token") as ws:
            res = _rpc(ws, 1, "writeFile", {"path": "/created.txt", "content": content})
            assert res["payload"]["success"] is True
            assert (served_root / "created.txt").read_text() == "new content"

            res = _rpc(ws, 2, "readFile", {"path": "/created.txt"})
            assert base64.b64decode(res["payload"]["content"]) == b"new content"
            assert res["payload"]["fingerprint"]["hash"] is not None


def test_create_delete_rename(served_root):
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=test-token") as ws:
            assert _rpc(ws, 1, "createDirectory", {"path": "/newdir"})["payload"]["success"]
            assert (served_root / "newdir").is_dir()

            base64_c = base64.b64encode(b"x").decode()
            _rpc(ws, 2, "writeFile", {"path": "/newdir/a.txt", "content": base64_c})
            res = _rpc(ws, 3, "rename", {"oldPath": "/newdir/a.txt", "newPath": "/newdir/b.txt"})
            assert res["payload"]["success"] is True
            assert (served_root / "newdir" / "b.txt").exists()

            res = _rpc(ws, 4, "delete", {"path": "/newdir", "recursive": True})
            assert res["payload"]["success"] is True
            assert not (served_root / "newdir").exists()


def test_path_traversal_blocked(served_root):
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=test-token") as ws:
            res = _rpc(ws, 1, "stat", {"path": "/../../etc/passwd"})
            assert res["type"] == "error"


def test_expanded_dirs_recorded(served_root):
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=test-token") as ws:
            res = _rpc(ws, 1, "expandedDirs", {"paths": ["/subdir"]})
            assert res["payload"]["success"] is True
            assert "/subdir" in main_module.state.expanded_dirs
