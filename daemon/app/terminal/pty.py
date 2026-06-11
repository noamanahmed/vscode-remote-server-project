import os
import pty
import fcntl
import shutil
import struct
import signal
import termios
import asyncio
import logging
from typing import Dict, Callable, Awaitable, Optional, List

logger = logging.getLogger("remotefs-daemon.terminal")

# Candidate shells in preference order, covering Debian/Ubuntu (bash) and
# Alpine/BusyBox (ash/sh) and zsh-based systems.
_SHELL_CANDIDATES = [
    "/bin/bash", "/usr/bin/bash",
    "/bin/zsh", "/usr/bin/zsh",
    "/bin/ash", "/usr/bin/ash",
    "/bin/sh", "/usr/bin/sh",
]


def _resolve_shell() -> str:
    """Pick a usable login shell that exists on this host (bash on Debian,
    ash/sh on Alpine, etc.)."""
    env_shell = os.environ.get("SHELL")
    if env_shell and os.path.isfile(env_shell) and os.access(env_shell, os.X_OK):
        return env_shell
    for cand in _SHELL_CANDIDATES:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return shutil.which("sh") or "/bin/sh"


def _shell_argv(shell: str) -> List[str]:
    """Login shell for bash/zsh (sources profiles); a bare interactive shell for
    minimal sh/ash variants that may reject -l."""
    base = os.path.basename(shell)
    if base in ("bash", "zsh"):
        return [shell, "-l"]
    return [shell]


class _Terminal:
    def __init__(self, terminal_id: str, pid: int, master_fd: int):
        self.id = terminal_id
        self.pid = pid
        self.master_fd = master_fd


class TerminalManager:
    """
    Per-connection manager for real server-side PTYs. Each terminal runs the
    server's login shell so it looks and behaves exactly like the remote shell.
    Output is streamed to the owning WebSocket via ``send_event``.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop,
                 send_event: Callable[[dict], Awaitable[None]], cwd: str):
        self._loop = loop
        self._send_event = send_event
        self._cwd = cwd
        self._terminals: Dict[str, _Terminal] = {}
        self._counter = 0

    def create(self, cols: int = 80, rows: int = 24) -> str:
        self._counter += 1
        terminal_id = f"t{self._counter}"

        shell = _resolve_shell()
        argv = _shell_argv(shell)
        cwd = self._cwd
        logger.info(f"Spawning terminal {terminal_id} with shell {shell}")

        pid, master_fd = pty.fork()
        if pid == 0:
            # Child. It must NEVER return into the parent's event-loop code,
            # even if exec fails (a missing shell, etc.) — always _exit.
            try:
                try:
                    os.chdir(cwd)
                except Exception:
                    pass
                env = os.environ.copy()
                env["TERM"] = env.get("TERM", "xterm-256color")
                os.execvpe(shell, argv, env)
            except BaseException:
                pass
            os._exit(127)

        # Parent.
        self._set_winsize(master_fd, rows, cols)
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        term = _Terminal(terminal_id, pid, master_fd)
        self._terminals[terminal_id] = term
        self._loop.add_reader(master_fd, self._on_readable, terminal_id)
        logger.info(f"Terminal {terminal_id} created (pid={pid})")
        return terminal_id

    def _on_readable(self, terminal_id: str):
        term = self._terminals.get(terminal_id)
        if not term:
            return
        try:
            data = os.read(term.master_fd, 65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            data = b""

        if not data:
            self._handle_exit(terminal_id)
            return

        self._loop.create_task(self._send_event({
            "id": 0,
            "type": "terminal.data",
            "payload": {"terminalId": terminal_id,
                        "data": data.decode("utf-8", errors="replace")},
        }))

    def input(self, terminal_id: str, data: str):
        term = self._terminals.get(terminal_id)
        if not term:
            return
        try:
            os.write(term.master_fd, data.encode("utf-8"))
        except OSError as e:
            logger.error(f"Terminal {terminal_id} write failed: {e}")

    def resize(self, terminal_id: str, cols: int, rows: int):
        term = self._terminals.get(terminal_id)
        if term:
            self._set_winsize(term.master_fd, rows, cols)

    @staticmethod
    def _set_winsize(fd: int, rows: int, cols: int):
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    def _handle_exit(self, terminal_id: str, notify: bool = True):
        term = self._terminals.pop(terminal_id, None)
        if not term:
            return
        try:
            self._loop.remove_reader(term.master_fd)
        except Exception:
            pass
        code = None
        try:
            _, status = os.waitpid(term.pid, os.WNOHANG)
            code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
        except ChildProcessError:
            pass
        try:
            os.close(term.master_fd)
        except OSError:
            pass
        logger.info(f"Terminal {terminal_id} exited (code={code})")
        if notify:
            self._loop.create_task(self._send_event({
                "id": 0,
                "type": "terminal.exit",
                "payload": {"terminalId": terminal_id, "code": code},
            }))

    def close(self, terminal_id: str):
        term = self._terminals.get(terminal_id)
        if not term:
            return
        try:
            os.kill(term.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        self._handle_exit(terminal_id, notify=False)

    def close_all(self):
        for terminal_id in list(self._terminals.keys()):
            self.close(terminal_id)
