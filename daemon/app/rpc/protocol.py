from pydantic import BaseModel
from typing import Any, Optional, Union

class RPCRequest(BaseModel):
    id: int
    type: str
    payload: Any

class RPCResponse(BaseModel):
    id: int
    type: str
    payload: Optional[Any] = None
    error: Optional[str] = None
