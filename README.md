# RemoteFS VS Code Extension

A **daemon-first remote filesystem** provider for VS Code. Every operation —
file read/write, directory listing, search, and the integrated terminal — runs
on a lightweight Python daemon on your server and streams to VS Code over a
single WebSocket. There is **no local mount to set up**: the daemon serves one
folder, and VS Code talks to it directly.

## Architecture

- **Daemon-first I/O**: All filesystem operations are executed on the server by the daemon. The extension is a thin client; nothing is read from a local mount.
- **Served folder**: The daemon serves a single root directory (its `--folder` argument). All paths VS Code sends are relative to that root.
- **Top-level cache**: The daemon warms the first-level directory listing at startup so the explorer paints in a single round-trip on first connect.
- **Live file watching**: A server-side watcher pushes create/update/delete events to VS Code so the explorer and open editors stay in sync automatically.
- **Git branch monitoring**: When the branch changes on the server, the daemon resends the top-level tree (and any directories you have expanded) so the workspace reflects the new branch.
- **Override detection**: When you switch back to an open file after a dropped connection, the extension verifies it against the server and warns you if it was overwritten while you had unsaved edits.
- **Remote terminal**: Open a real shell on the server (a true PTY) directly inside VS Code.
- **Remote search**: Project-wide text and filename search via `ripgrep` on the server, streamed in real time.

## Features

- [x] **Fully remote operations** — read/write/list/rename/delete all happen on the daemon.
- [x] **Server-side file watcher** — external changes appear in VS Code instantly.
- [x] **Git branch awareness** — the tree refreshes when the branch changes.
- [x] **Remote terminal** — a real server shell inside VS Code.
- [x] **Stale/override detection** — never silently lose work to a server-side overwrite.
- [x] **Remote search** — deep project search with `ripgrep`, streamed live.

## Installation

### 1. Setup the Daemon (on the server)

```bash
cd daemon
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Install ripgrep

The daemon requires `ripgrep` (`rg`) on the server's `$PATH`:

```bash
sudo apt install ripgrep
```

### 3. Run the Daemon

```bash
python3 -m app.main --folder /var/www/your-project --token your-secret-token
```

- `--folder` is the directory the daemon serves (defaults to the current working directory).
- `--host` / `--port` control the bind address (defaults: `0.0.0.0` / `8765`).
- If `--token` is omitted, a random token is generated and logged to the console.

You can also configure the daemon via environment variables (`REMOTEFS_FOLDER`,
`REMOTEFS_TOKEN`), which is convenient when launching with `uvicorn` or Docker.

## Connecting from VS Code

### Option A — Command Palette

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **RemoteFS: Setup Connection** and enter the daemon **Host**, **Port**, and **Token**.
   The extension stores these in settings and opens the served folder.

Already configured? Just run **RemoteFS: Connect to Remote Folder**.

### Option B — CLI One-Liner

Open the remote folder directly from your terminal, passing the connection
details in the URI:

```bash
code --folder-uri "remotefs:/?host=10.0.0.1&port=8765&token=your-secret-token"
```

The path is always `/` — the daemon decides which folder is served via its
`--folder` argument. The `host`/`port`/`token` query values are adopted
automatically on launch.

### Open a Remote Terminal

Run **RemoteFS: Open Remote Terminal** from the Command Palette to get a real
shell on the server.

## Configuration

Settings live under `remotefs.*` in VS Code settings:

- `remotefs.host`: Daemon host address (default: `localhost`).
- `remotefs.port`: Daemon port (default: `8765`).
- `remotefs.token`: Authentication token (default: empty).

Connection values passed in the launch URI (Option B) take precedence over these
settings for that window.

## Auto-start on Boot

If the project is cloned to `/opt/vscode-remote-server-project`, you can use the
provided startup scripts. Edit the `--folder` path in them to point at the
directory you want to serve.

### For Systemd (Ubuntu, Debian, CentOS, etc.)

1. Edit `remotefs.service` and set `--folder` to your project path.
2. Copy the service file to systemd:
   ```bash
   sudo cp /opt/vscode-remote-server-project/remotefs.service /etc/systemd/system/
   ```
3. Enable and start:
   ```bash
   sudo systemctl enable remotefs
   sudo systemctl start remotefs
   ```

### For OpenRC (Alpine, Gentoo, etc.)

1. Move the init script:
   ```bash
   sudo cp /opt/vscode-remote-server-project/remotefs.init /etc/init.d/remotefs
   ```
2. Make it executable:
   ```bash
   sudo chmod +x /etc/init.d/remotefs
   ```
3. Start and enable:
   ```bash
   sudo rc-service remotefs start
   sudo rc-update add remotefs default
   ```

## Troubleshooting

- **Quick Open (`Ctrl+P`) or Search returns nothing**: these rely on VS Code's proposed search APIs. Make sure you are running a build of VS Code where the extension's proposed APIs are enabled.
- **`start-stop-daemon: ... does not exist`**: verify the project path, that the virtualenv exists (`cd daemon && python3 -m venv venv`), and that you copied the latest `remotefs.init` / `remotefs.service`.
- **Connection fails**: confirm the daemon is running, the port is reachable, and the token matches.
