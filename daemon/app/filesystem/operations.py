import os
import stat
import shutil
import hashlib
import aiofiles
import logging
from typing import List, Dict, Any

logger = logging.getLogger("remotefs-daemon.operations")

# Files larger than this skip content hashing in fingerprint() and fall back
# to (mtime, size) only, to keep focus-checks cheap.
FINGERPRINT_HASH_MAX_BYTES = 8 * 1024 * 1024


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
            try:
                s = entry.stat()
            except OSError:
                # Broken symlink or vanished entry mid-scan; skip it.
                continue
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
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    async with aiofiles.open(path, mode='wb') as f:
        await f.write(content)


async def create_directory(path: str):
    logger.debug(f"create_directory: {path}")
    os.makedirs(path, exist_ok=True)


async def delete(path: str, recursive: bool = True):
    logger.debug(f"delete: {path} (recursive={recursive})")
    if os.path.isdir(path) and not os.path.islink(path):
        if recursive:
            shutil.rmtree(path)
        else:
            os.rmdir(path)
    else:
        os.remove(path)


async def rename(old_path: str, new_path: str, overwrite: bool = False):
    logger.debug(f"rename: {old_path} -> {new_path} (overwrite={overwrite})")
    if os.path.exists(new_path):
        if not overwrite:
            raise FileExistsError(f"Target already exists: {new_path}")
        if os.path.isdir(new_path) and not os.path.islink(new_path):
            shutil.rmtree(new_path)
        else:
            os.remove(new_path)
    parent = os.path.dirname(new_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    os.replace(old_path, new_path)


async def fingerprint(path: str) -> Dict[str, Any]:
    """
    Cheap content identity used for stale/override detection.
    Returns mtime + size always, and a content hash for reasonably sized files.
    """
    s = os.stat(path)
    result: Dict[str, Any] = {
        "mtime": int(s.st_mtime * 1000),
        "size": s.st_size,
        "hash": None,
    }
    if stat.S_ISREG(s.st_mode) and s.st_size <= FINGERPRINT_HASH_MAX_BYTES:
        h = hashlib.blake2b(digest_size=16)
        async with aiofiles.open(path, mode='rb') as f:
            while True:
                chunk = await f.read(1024 * 256)
                if not chunk:
                    break
                h.update(chunk)
        result["hash"] = h.hexdigest()
    return result
