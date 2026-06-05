import os
import base64
import json
import asyncio
import logging
import secrets
import argparse
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, status
from .rpc.protocol import RPCRequest, RPCResponse
from .filesystem import operations
from .search import ripgrep

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("remotefs-daemon")

app = FastAPI(title="RemoteFS Daemon")

# This will be set in the main block
auth_token = None

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    if auth_token and token != auth_token:
        logger.warning(f"Unauthorized connection attempt with token: {token}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication token")
        return

    await websocket.accept()
    logger.info("WebSocket client connected and authenticated")
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received message: {data[:200]}{'...' if len(data) > 200 else ''}")
            message = json.loads(data)
            request = RPCRequest(**message)
            
            # Special handling for streaming search
            if request.type == "search":
                try:
                    async for result in ripgrep.run_search(request.payload["pattern"], request.payload["path"], request.payload.get("options")):
                        event = RPCResponse(id=request.id, type="searchResult", payload=result)
                        await websocket.send_text(event.json())
                    
                    done_response = RPCResponse(id=request.id, type="done")
                    await websocket.send_text(done_response.json())
                except Exception as e:
                    logger.error(f"Search error: {e}")
                    error_response = RPCResponse(id=request.id, type="error", error=str(e))
                    await websocket.send_text(error_response.json())
            else:
                response = await handle_request(request)
                await websocket.send_text(response.json())
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except:
            pass

async def handle_request(request: RPCRequest) -> RPCResponse:
    payload = request.payload
    logger.debug(f"Handling request type: {request.type} (ID: {request.id})")
    try:
        if request.type == "stat":
            result = await operations.get_stat(payload["path"])
            return RPCResponse(id=request.id, type="stat", payload=result)
        
        elif request.type == "readDirectory":
            result = await operations.list_dir(payload["path"])
            return RPCResponse(id=request.id, type="readDirectory", payload={"entries": result})
        
        elif request.type == "readFile":
            content = await operations.read_file(payload["path"])
            encoded = base64.b64encode(content).decode('utf-8')
            return RPCResponse(id=request.id, type="readFile", payload={"content": encoded})
        
        elif request.type == "writeFile":
            content = base64.b64decode(payload["content"])
            await operations.write_file(payload["path"], content)
            return RPCResponse(id=request.id, type="writeFile", payload={"success": True})
        
        elif request.type == "fileSearch":
            result = await ripgrep.run_file_search(payload.get("pattern", ""), payload["path"])
            return RPCResponse(id=request.id, type="fileSearch", payload={"files": result})
            
        else:
            logger.warning(f"Unknown request type: {request.type}")
            return RPCResponse(id=request.id, type="error", error=f"Unknown request type: {request.type}")
            
    except Exception as e:
        logger.error(f"Error handling request {request.type}: {e}")
        return RPCResponse(id=request.id, type="error", error=str(e))

import sys
import shutil

def check_ripgrep():
    if not shutil.which('rg'):
        logger.error("Ripgrep ('rg') is not installed or not in PATH. Please install it (e.g. 'sudo apt install ripgrep').")
        return False
    logger.info("Ripgrep ('rg') found.")
    return True

if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description="RemoteFS Daemon")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind to")
    parser.add_argument("--token", help="Authentication token (optional)")
    args = parser.parse_args()

    if args.token:
        auth_token = args.token
        logger.info(f"Authentication enabled with provided token")
    else:
        auth_token = secrets.token_urlsafe(32)
        logger.info(f"Authentication enabled with generated token: {auth_token}")

    if check_ripgrep():
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        sys.exit(1)
