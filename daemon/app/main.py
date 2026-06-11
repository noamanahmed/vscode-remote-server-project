import os
import sys
import base64
import json
import asyncio
import logging
import secrets
import shutil
import argparse
from typing import Optional, Set, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status

from .rpc.protocol import RPCRequest, RPCResponse
from .filesystem import operations
from .filesystem.cache import DirectoryCache
from .filesystem.watcher import FileWatcher
from .git.watcher import GitWatcher
from .terminal.pty import TerminalManager
from .search import ripgrep

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("remotefs-daemon")

app = FastAPI(title="RemoteFS Daemon")

# Set in the main block / configure().
auth_token: Optional[str] = None


class AppState:
    """Process-wide daemon state: served root, connections, caches, watchers."""

    def __init__(self):
        self.root: str = os.getcwd()
        self.connections: Set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.expanded_dirs: Set[str] = set()
        self.cache: Optional[DirectoryCache] = None
        self.file_watcher: Optional[FileWatcher] = None
        self.git_watcher: Optional[GitWatcher] = None

    # --- path helpers -----------------------------------------------------
    def resolve(self, rel_path: str) -> str:
        """Map a root-relative request path to an absolute path, guarding
        against traversal outside the served root."""
        rel = (rel_path or "/").lstrip("/")
        abs_path = os.path.realpath(os.path.join(self.root, rel))
        if abs_path != self.root and not abs_path.startswith(self.root + os.sep):
            raise PermissionError(f"Path escapes served root: {rel_path}")
        return abs_path

    def to_rel(self, abs_path: str) -> Optional[str]:
        real = os.path.realpath(abs_path)
        if real == self.root:
            return "/"
        if not real.startswith(self.root + os.sep):
            raise ValueError(f"Path outside root: {abs_path}")
        return "/" + os.path.relpath(real, self.root).replace(os.sep, "/")

    # --- broadcasting -----------------------------------------------------
    async def broadcast(self, message: dict):
        text = json.dumps(message)
        for ws in list(self.connections):
            try:
                await ws.send_text(text)
            except Exception:
                self.connections.discard(ws)

    def broadcast_threadsafe(self, message: dict):
        """Schedule a broadcast from a non-async thread (file watcher)."""
        if self.loop:
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)


state = AppState()


@app.on_event("startup")
async def on_startup():
    state.loop = asyncio.get_running_loop()
    state.cache = DirectoryCache(state.resolve)
    try:
        await state.cache.warm_top_level()
        logger.info(f"Top-level directory cache warmed for {state.root}")
    except Exception as e:
        logger.error(f"Failed to warm cache: {e}")

    state.file_watcher = FileWatcher(
        root=state.root,
        to_rel=state.to_rel,
        cache=state.cache,
        emit=state.broadcast_threadsafe,
    )
    state.file_watcher.start()

    state.git_watcher = GitWatcher(
        root=state.root,
        cache=state.cache,
        get_expanded=lambda: list(state.expanded_dirs),
        broadcast=state.broadcast,
    )
    state.git_watcher.start()


@app.on_event("shutdown")
async def on_shutdown():
    if state.file_watcher:
        state.file_watcher.stop()
    if state.git_watcher:
        await state.git_watcher.stop()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    if auth_token and token != auth_token:
        logger.warning("Unauthorized connection attempt")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication token")
        return

    await websocket.accept()
    state.connections.add(websocket)
    logger.info("WebSocket client connected and authenticated")

    async def send_event(message: dict):
        await websocket.send_text(json.dumps(message))

    terminals = TerminalManager(asyncio.get_running_loop(), send_event, state.root)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            request = RPCRequest(**message)
            await dispatch(request, websocket, terminals)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        state.connections.discard(websocket)
        terminals.close_all()


async def dispatch(request: RPCRequest, websocket: WebSocket, terminals: TerminalManager):
    rtype = request.type
    payload = request.payload or {}

    # Streaming search keeps its own protocol.
    if rtype == "search":
        await _handle_search(request, websocket)
        return

    # Terminal control messages are fire-and-forget (output arrives as events).
    if rtype.startswith("terminal."):
        _handle_terminal(rtype, payload, terminals, request, websocket)
        return

    response = await handle_request(request)
    if response is not None:
        await websocket.send_text(response.json())


async def _handle_search(request: RPCRequest, websocket: WebSocket):
    payload = request.payload or {}
    try:
        abs_path = state.resolve(payload["path"])
        async for result in ripgrep.run_search(payload["pattern"], abs_path, payload.get("options")):
            # Convert absolute match paths back to root-relative for the client.
            try:
                result["path"] = state.to_rel(result["path"])
            except ValueError:
                pass
            event = RPCResponse(id=request.id, type="searchResult", payload=result)
            await websocket.send_text(event.json())
        await websocket.send_text(RPCResponse(id=request.id, type="done").json())
    except Exception as e:
        logger.error(f"Search error: {e}")
        await websocket.send_text(RPCResponse(id=request.id, type="error", error=str(e)).json())


def _handle_terminal(rtype, payload, terminals: TerminalManager, request, websocket: WebSocket):
    if rtype == "terminal.create":
        tid = terminals.create(payload.get("cols", 80), payload.get("rows", 24))
        state.loop.create_task(
            websocket.send_text(RPCResponse(id=request.id, type="terminal.created",
                                            payload={"terminalId": tid}).json())
        )
    elif rtype == "terminal.input":
        terminals.input(payload["terminalId"], payload["data"])
    elif rtype == "terminal.resize":
        terminals.resize(payload["terminalId"], payload.get("cols", 80), payload.get("rows", 24))
    elif rtype == "terminal.close":
        terminals.close(payload["terminalId"])


async def handle_request(request: RPCRequest) -> Optional[RPCResponse]:
    payload = request.payload or {}
    logger.debug(f"Handling request type: {request.type} (ID: {request.id})")
    try:
        if request.type == "init":
            tree = await state.cache.get("/")
            return RPCResponse(id=request.id, type="init", payload={
                "root": state.root,
                "name": os.path.basename(state.root.rstrip(os.sep)) or state.root,
                "branch": state.git_watcher.current_branch if state.git_watcher else None,
                "tree": tree,
            })

        if request.type == "stat":
            result = await operations.get_stat(state.resolve(payload["path"]))
            return RPCResponse(id=request.id, type="stat", payload=result)

        if request.type == "readDirectory":
            result = await state.cache.get(payload["path"])
            return RPCResponse(id=request.id, type="readDirectory", payload={"entries": result})

        if request.type == "readFile":
            abs_path = state.resolve(payload["path"])
            content = await operations.read_file(abs_path)
            encoded = base64.b64encode(content).decode("utf-8")
            fp = await operations.fingerprint(abs_path)
            return RPCResponse(id=request.id, type="readFile",
                               payload={"content": encoded, "fingerprint": fp})

        if request.type == "writeFile":
            content = base64.b64decode(payload["content"])
            await operations.write_file(state.resolve(payload["path"]), content)
            return RPCResponse(id=request.id, type="writeFile", payload={"success": True})

        if request.type == "createDirectory":
            await operations.create_directory(state.resolve(payload["path"]))
            return RPCResponse(id=request.id, type="createDirectory", payload={"success": True})

        if request.type == "delete":
            await operations.delete(state.resolve(payload["path"]),
                                    payload.get("recursive", True))
            return RPCResponse(id=request.id, type="delete", payload={"success": True})

        if request.type == "rename":
            await operations.rename(state.resolve(payload["oldPath"]),
                                    state.resolve(payload["newPath"]),
                                    payload.get("overwrite", False))
            return RPCResponse(id=request.id, type="rename", payload={"success": True})

        if request.type == "fingerprint":
            result = await operations.fingerprint(state.resolve(payload["path"]))
            return RPCResponse(id=request.id, type="fingerprint", payload=result)

        if request.type == "expandedDirs":
            state.expanded_dirs = set(payload.get("paths", []))
            return RPCResponse(id=request.id, type="expandedDirs", payload={"success": True})

        if request.type == "fileSearch":
            abs_path = state.resolve(payload["path"])
            result = await ripgrep.run_file_search(payload.get("pattern", ""), abs_path)
            rel_files = []
            for f in result:
                try:
                    rel_files.append(state.to_rel(f))
                except ValueError:
                    pass
            return RPCResponse(id=request.id, type="fileSearch", payload={"files": rel_files})

        logger.warning(f"Unknown request type: {request.type}")
        return RPCResponse(id=request.id, type="error", error=f"Unknown request type: {request.type}")

    except Exception as e:
        logger.error(f"Error handling request {request.type}: {e}")
        return RPCResponse(id=request.id, type="error", error=str(e))


def check_ripgrep() -> bool:
    if not shutil.which("rg"):
        logger.error("Ripgrep ('rg') is not installed or not in PATH. Install it (e.g. 'sudo apt install ripgrep').")
        return False
    logger.info("Ripgrep ('rg') found.")
    return True


def configure(folder: str, token: Optional[str], generate_token: bool = True):
    global auth_token
    root = os.path.realpath(os.path.abspath(folder))
    if not os.path.isdir(root):
        logger.error(f"Served folder does not exist or is not a directory: {root}")
        sys.exit(1)
    state.root = root
    logger.info(f"Serving folder: {root}")

    if token:
        auth_token = token
        logger.info("Authentication enabled with provided token")
    elif generate_token:
        auth_token = secrets.token_urlsafe(32)
        logger.info(f"Authentication enabled with generated token: {auth_token}")
    else:
        auth_token = None
        logger.warning("No token configured; authentication is DISABLED")


def _apply_env_config():
    """
    Apply REMOTEFS_FOLDER / REMOTEFS_TOKEN so the daemon is configurable when
    launched via `uvicorn app.main:app` (which never runs the __main__ block).
    The CLI path below overrides these.
    """
    global auth_token
    folder = os.environ.get("REMOTEFS_FOLDER")
    if folder:
        state.root = os.path.realpath(os.path.abspath(folder))
    token = os.environ.get("REMOTEFS_TOKEN")
    if token:
        auth_token = token


# Applied at import time so the uvicorn entrypoint picks up environment config.
_apply_env_config()


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description="RemoteFS Daemon")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind to")
    parser.add_argument("--token", help="Authentication token (optional)")
    parser.add_argument("--folder", default=os.getcwd(),
                        help="Absolute path of the folder to serve (default: current directory)")
    args = parser.parse_args()

    configure(args.folder, args.token)

    if check_ripgrep():
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        sys.exit(1)
