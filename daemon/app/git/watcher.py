import os
import asyncio
import logging
from typing import Callable, Optional, Awaitable, List

logger = logging.getLogger("remotefs-daemon.git")


def _read_branch(root: str) -> Optional[str]:
    """
    Resolve the current branch by reading .git/HEAD directly (no subprocess).
    Returns the branch name, a short commit hash for detached HEAD, or None
    when the root is not a git repository.
    """
    head_path = os.path.join(root, ".git", "HEAD")
    if not os.path.isfile(head_path):
        return None
    try:
        with open(head_path, "r") as f:
            content = f.read().strip()
    except OSError:
        return None
    if content.startswith("ref:"):
        ref = content[4:].strip()
        return ref.rsplit("/", 1)[-1]  # refs/heads/main -> main
    return content[:12]  # detached HEAD -> short sha


class GitWatcher:
    """
    Polls .git/HEAD for branch changes. On a change it rebuilds the top-level
    tree and re-lists every directory the client currently has expanded, then
    pushes a single ``git.branchChanged`` event.
    """

    def __init__(self, root: str, cache, get_expanded: Callable[[], List[str]],
                 broadcast: Callable[[dict], Awaitable[None]], poll_seconds: float = 2.0):
        self._root = root
        self._cache = cache
        self._get_expanded = get_expanded
        self._broadcast = broadcast
        self._poll = poll_seconds
        self._task: Optional[asyncio.Task] = None
        self._current = _read_branch(root)

    @property
    def current_branch(self) -> Optional[str]:
        return self._current

    def start(self):
        self._task = asyncio.create_task(self._run())
        logger.info(f"Git watcher started (branch: {self._current})")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self):
        try:
            while True:
                await asyncio.sleep(self._poll)
                branch = _read_branch(self._root)
                if branch is not None and branch != self._current:
                    logger.info(f"Branch changed: {self._current} -> {branch}")
                    self._current = branch
                    await self._emit_change(branch)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Git watcher error: {e}")

    async def _emit_change(self, branch: str):
        # The whole working tree may differ; drop cached listings and rebuild.
        self._cache.clear()
        tree = await self._cache.warm_top_level()

        expanded: dict = {}
        for rel in self._get_expanded():
            try:
                expanded[rel] = await self._cache.get(rel, force=True)
            except OSError:
                # Directory no longer exists on the new branch.
                expanded[rel] = None

        await self._broadcast({
            "id": 0,
            "type": "git.branchChanged",
            "payload": {"branch": branch, "tree": tree, "expanded": expanded},
        })
