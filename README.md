# RemoteFS VS Code Extension

A high-performance remote filesystem provider for VS Code that completely avoids NFS/SSHFS overhead by moving file operations and search to a remote daemon.

## Architecture

- **Extension**: VS Code extension that implements `FileSystemProvider`, `TextSearchProvider`, and `FileSearchProvider` using the `remotefs://` scheme.
- **Daemon**: A Python 3.12+ backend running on the server, exposing a WebSocket RPC API for filesystem and search operations.

## Features (Phase 1)

- [x] Basic Filesystem Provider (`remotefs://`)
- [x] Browsing remote directories
- [x] Opening / Reading remote files
- [x] Saving / Writing remote files
- [x] Supporting Multiple Projects via absolute paths

## Installation

### 1. Setup Daemon (on Server)

```bash
cd daemon
python3 -m venv venv --without-pip
source venv/bin/activate
curl https://bootstrap.pypa.io/get-pip.py | python3
pip install -r requirements.txt
```

### 2. Run Daemon

You can run the daemon manually:
```bash
python3 -m app.main
```
Or set up a systemd service (see below).

### 3. Setup Extension (Locally)

```bash
cd extension
npm install
npm run compile
```

Open the `extension` folder in VS Code and press `F5` to launch the extension in a new window.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run `RemoteFS: Open Remote Workspace`.
3. Enter the absolute path on the remote server (e.g., `/home/user/my-project`).
4. The remote folder will be added to your current VS Code workspace.

## Systemd Setup

To run the daemon as a background service:

1. Copy the service file (edit `User` and `WorkingDirectory` if needed):
   ```bash
   sudo cp remotefs.service /etc/systemd/system/
   ```
2. Reload systemd and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable remotefs
   sudo systemctl start remotefs
   ```
3. Check status:
   ```bash
   sudo systemctl status remotefs
   ```

## Requirements

- **Server**: Python 3.12+, `ripgrep` (for future phases)
- **Client**: VS Code 1.85.0+
