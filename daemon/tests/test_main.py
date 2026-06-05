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

def test_read_main_not_found():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 404

def test_websocket_auth_success():
    client = TestClient(app)
    with client.websocket_connect("/ws?token=test-token") as websocket:
        # If we reach here, connection was successful
        assert True

def test_websocket_auth_failure():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws?token=wrong-token") as websocket:
            pass
    assert excinfo.value.code == status.WS_1008_POLICY_VIOLATION

def test_websocket_auth_missing():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws") as websocket:
            pass
    assert excinfo.value.code == status.WS_1008_POLICY_VIOLATION
