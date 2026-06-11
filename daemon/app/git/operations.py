import asyncio
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("remotefs-daemon.git.operations")


def _rel(path: str) -> str:
    """Convert a root-relative request path ('/src/a.ts') to a repo-relative
    path ('src/a.ts'). The served root is the repo root."""
    return (path or "").lstrip("/")


async def _run_git(root: str, args: List[str], check: bool = True) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", root, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    if check and proc.returncode != 0:
        msg = err.decode("utf-8", "replace").strip() or f"git {' '.join(args)} failed"
        raise RuntimeError(msg)
    return out


async def is_repo(root: str) -> bool:
    try:
        out = await _run_git(root, ["rev-parse", "--is-inside-work-tree"], check=False)
        return out.decode().strip() == "true"
    except Exception:
        return False


async def status(root: str) -> Dict[str, Any]:
    """Returns the working-tree status as a list of entries plus the branch."""
    out = await _run_git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    tokens = out.decode("utf-8", "replace").split("\0")
    entries: List[Dict[str, Any]] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if not tok:
            i += 1
            continue
        index = tok[0]
        working = tok[1]
        path = tok[3:]
        orig: Optional[str] = None
        if index in ("R", "C"):
            # The source path follows as the next NUL-separated token.
            i += 1
            orig = tokens[i] if i < len(tokens) else None
        entries.append({
            "path": "/" + path,
            "origPath": ("/" + orig) if orig else None,
            "index": index,
            "workingTree": working,
        })
        i += 1

    branch_out = await _run_git(root, ["rev-parse", "--abbrev-ref", "HEAD"], check=False)
    branch = branch_out.decode().strip() or None
    return {"branch": branch, "entries": entries}


async def show(root: str, path: str, ref: str = "HEAD") -> Optional[bytes]:
    """Return the file's contents at a ref (default HEAD), or None if absent."""
    rel = _rel(path)
    try:
        return await _run_git(root, ["show", f"{ref}:{rel}"])
    except RuntimeError:
        # New/untracked file has no committed version.
        return None


async def stage(root: str, paths: List[str]):
    rels = [_rel(p) for p in paths]
    await _run_git(root, ["add", "--", *rels])


async def unstage(root: str, paths: List[str]):
    rels = [_rel(p) for p in paths]
    # reset is safe even when HEAD has no prior version of the file.
    await _run_git(root, ["reset", "-q", "HEAD", "--", *rels], check=False)


async def discard(root: str, paths: List[str]):
    rels = [_rel(p) for p in paths]
    await _run_git(root, ["checkout", "--", *rels], check=False)


async def commit(root: str, message: str) -> Dict[str, Any]:
    if not message or not message.strip():
        raise RuntimeError("Commit message is empty")
    await _run_git(root, ["commit", "-m", message])
    return await status(root)
