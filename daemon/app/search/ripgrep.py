import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, Any, List

logger = logging.getLogger("remotefs-daemon.search")

async def run_search(pattern: str, root_path: str, options: Dict[str, Any] = None) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run ripgrep search and yield results as they come.
    """
    args = ["rg", "--json", pattern, root_path]
    
    if options:
        if options.get("caseSensitive") is False:
            args.insert(2, "-i")
        if options.get("isRegexp"):
            args.insert(2, "-e")
        else:
            args.insert(2, "-F") # Fixed strings

    logger.info(f"Running search: {' '.join(args)}")
    
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    try:
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            
            try:
                data = json.loads(line.decode('utf-8'))
                if data["type"] == "match":
                    yield {
                        "path": data["data"]["path"]["text"],
                        "line": data["data"]["line_number"],
                        "column": data["data"]["submatches"][0]["start"],
                        "text": data["data"]["lines"]["text"]
                    }
            except Exception as e:
                logger.error(f"Error parsing ripgrep output: {e}")
                
        await process.wait()
    except asyncio.CancelledError:
        logger.info("Search cancelled, terminating process")
        process.terminate()
        await process.wait()
        raise

async def run_file_search(pattern: str, root_path: str) -> List[str]:
    """
    Run a simple filename search using find or similar logic.
    For now, let's use ripgrep --files and filter locally or use fd.
    Since ripgrep is already installed, let's use it.
    """
    args = ["rg", "--files", root_path]
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        logger.error(f"File search failed: {stderr.decode()}")
        return []
        
    all_files = stdout.decode().splitlines()
    if not pattern:
        return all_files
        
    return [f for f in all_files if pattern.lower() in f.lower()]
