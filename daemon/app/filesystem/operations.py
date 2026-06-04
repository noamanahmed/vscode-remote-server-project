import os
import stat
import aiofiles
import logging
from typing import List, Dict, Any

logger = logging.getLogger("remotefs-daemon.operations")

async def get_stat(path: str) -> Dict[str, Any]:
    logger.debug(f"get_stat: {path}")
    s = os.stat(path)
    return {
        "type": 1 if stat.S_ISREG(s.st_mode) else 2 if stat.S_ISDIR(s.st_mode) else 0,
        "ctime": int(s.st_ctime * 1000),
        "mtime": int(s.st_mtime * 1000),
        "size": s.st_size
    }

async def list_dir(path: str) -> List[Dict[str, Any]]:
    logger.debug(f"list_dir: {path}")
    results = []
    with os.scandir(path) as it:
        for entry in it:
            s = entry.stat()
            results.append({
                "name": entry.name,
                "type": 1 if entry.is_file() else 2 if entry.is_dir() else 0,
                "ctime": int(s.st_ctime * 1000),
                "mtime": int(s.st_mtime * 1000),
                "size": s.st_size
            })
    return results

async def read_file(path: str) -> bytes:
    logger.debug(f"read_file: {path}")
    async with aiofiles.open(path, mode='rb') as f:
        return await f.read()

async def write_file(path: str, content: bytes):
    logger.debug(f"write_file: {path} (size: {len(content)})")
    # Ensure directory exists
    os.makedirs(os.path.dirname(path), exist_ok=True)
    async with aiofiles.open(path, mode='wb') as f:
        await f.write(content)
