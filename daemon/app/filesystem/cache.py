import asyncio
import logging
from collections import OrderedDict
from typing import Dict, List, Any, Optional

from . import operations

logger = logging.getLogger("remotefs-daemon.cache")


class DirectoryCache:
    """
    Caches directory listings keyed by root-relative path.

    The top-level ("/") listing is warmed at startup and kept ready so the
    first client connection can paint the explorer in a single round-trip.
    A bounded LRU holds recently listed sub-directories. The file watcher and
    git watcher invalidate entries so the cache never goes stale.
    """

    def __init__(self, resolve, max_entries: int = 256):
        # resolve: callable(rel_path) -> absolute path under the served root
        self._resolve = resolve
        self._max_entries = max_entries
        self._entries: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
        self._lock = asyncio.Lock()

    @staticmethod
    def _normalize(rel_path: str) -> str:
        if not rel_path:
            return "/"
        rel = "/" + rel_path.strip("/")
        return rel if rel != "//" else "/"

    async def warm_top_level(self) -> List[Dict[str, Any]]:
        """Build (or rebuild) the top-level listing. Called at startup."""
        return await self.get("/", force=True)

    async def get(self, rel_path: str, force: bool = False) -> List[Dict[str, Any]]:
        key = self._normalize(rel_path)
        async with self._lock:
            if not force and key in self._entries:
                self._entries.move_to_end(key)
                return self._entries[key]

        # List outside the lock; scandir can be slow on big dirs.
        entries = await operations.list_dir(self._resolve(key))

        async with self._lock:
            self._entries[key] = entries
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                evicted, _ = self._entries.popitem(last=False)
                logger.debug(f"cache evicted: {evicted}")
        return entries

    def invalidate(self, rel_path: str):
        """Invalidate the listing for a directory (sync; safe from any thread)."""
        key = self._normalize(rel_path)
        self._entries.pop(key, None)

    def invalidate_for_path(self, rel_file_path: str):
        """Invalidate the parent directory listing of a changed file/dir."""
        key = self._normalize(rel_file_path)
        parent = key.rsplit("/", 1)[0] or "/"
        self.invalidate(parent)

    def clear(self):
        self._entries.clear()

    def cached_keys(self) -> List[str]:
        return list(self._entries.keys())
