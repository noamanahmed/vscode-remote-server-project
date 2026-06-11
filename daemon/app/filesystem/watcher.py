import os
import threading
import logging
from typing import Callable, List, Dict

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

logger = logging.getLogger("remotefs-daemon.watcher")

# Directory/file names whose subtrees we never report.
IGNORED_DIR_NAMES = {".git", "node_modules", ".hg", ".svn", "__pycache__"}
# Suffixes produced by editors/tools as transient writes.
IGNORED_SUFFIXES = (".swp", ".swx", "~", ".tmp")


def _is_ignored(rel_path: str) -> bool:
    parts = rel_path.strip("/").split("/")
    if any(p in IGNORED_DIR_NAMES for p in parts):
        return True
    name = parts[-1] if parts else ""
    return name.startswith(".#") or name.endswith(IGNORED_SUFFIXES)


class _Handler(FileSystemEventHandler):
    def __init__(self, on_event: Callable[[str, str], None]):
        super().__init__()
        self._on_event = on_event

    def on_created(self, event):
        self._on_event("created", event.src_path)

    def on_deleted(self, event):
        self._on_event("deleted", event.src_path)

    def on_modified(self, event):
        if event.is_directory:
            return
        self._on_event("changed", event.src_path)

    def on_moved(self, event):
        self._on_event("deleted", event.src_path)
        self._on_event("created", event.dest_path)


class FileWatcher:
    """
    Recursively watches the served root with watchdog (runs in its own thread),
    coalesces bursts of events, invalidates the cache, and forwards a single
    batched ``fs.changed`` payload to ``emit`` (a thread-safe broadcaster).
    """

    def __init__(self, root: str, to_rel: Callable[[str], str], cache, emit: Callable[[dict], None],
                 debounce_seconds: float = 0.15):
        self._root = root
        self._to_rel = to_rel
        self._cache = cache
        self._emit = emit
        self._debounce = debounce_seconds
        self._observer = Observer()
        self._lock = threading.Lock()
        self._pending: "Dict[str, str]" = {}
        self._timer: threading.Timer = None

    def start(self):
        handler = _Handler(self._queue_event)
        self._observer.schedule(handler, self._root, recursive=True)
        self._observer.start()
        logger.info(f"File watcher started on {self._root}")

    def stop(self):
        try:
            self._observer.stop()
            self._observer.join(timeout=2)
        except Exception as e:
            logger.error(f"Error stopping file watcher: {e}")

    def _queue_event(self, change_type: str, abs_path: str):
        try:
            rel = self._to_rel(abs_path)
        except ValueError:
            return  # outside root
        if rel is None or _is_ignored(rel):
            return

        self._cache.invalidate_for_path(rel)
        if change_type in ("created", "deleted"):
            # A new/removed dir changes its own listing too.
            self._cache.invalidate(rel)

        with self._lock:
            # Last writer wins per path within the debounce window.
            self._pending[rel] = change_type
            if self._timer is None:
                self._timer = threading.Timer(self._debounce, self._flush)
                self._timer.daemon = True
                self._timer.start()

    def _flush(self):
        with self._lock:
            batch = self._pending
            self._pending = {}
            self._timer = None
        if not batch:
            return
        events: List[dict] = [{"type": t, "path": p} for p, t in batch.items()]
        self._emit({"id": 0, "type": "fs.changed", "payload": {"events": events}})
