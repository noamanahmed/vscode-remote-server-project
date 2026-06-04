import os
import base64
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from .rpc.protocol import RPCRequest, RPCResponse
from .filesystem import operations

app = FastAPI(title="RemoteFS Daemon")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            request = RPCRequest(**message)
            
            response = await handle_request(request)
            await websocket.send_text(response.json())
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        await websocket.close()

async def handle_request(request: RPCRequest) -> RPCResponse:
    payload = request.payload
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
            return RPCResponse(id=request.id, type="error", error=f"Unknown request type: {request.type}")
            
    except Exception as e:
        return RPCResponse(id=request.id, type="error", error=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
