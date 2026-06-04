import os
import base64
import json
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from .rpc.protocol import RPCRequest, RPCResponse
from .filesystem import operations

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("remotefs-daemon")

app = FastAPI(title="RemoteFS Daemon")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received message: {data[:200]}{'...' if len(data) > 200 else ''}")
            message = json.loads(data)
            request = RPCRequest(**message)
            
            response = await handle_request(request)
            await websocket.send_text(response.json())
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()

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
        
        else:
            logger.warning(f"Unknown request type: {request.type}")
            return RPCResponse(id=request.id, type="error", error=f"Unknown request type: {request.type}")
            
    except Exception as e:
        logger.error(f"Error handling request {request.type}: {e}")
        return RPCResponse(id=request.id, type="error", error=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
