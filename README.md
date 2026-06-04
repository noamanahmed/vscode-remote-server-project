# RemoteFS VS Code Extension

A high-performance **Hybrid Remote Filesystem** provider for VS Code. It combines the speed of local filesystem access (via NFS/SSHFS) with the power of server-side searching (via `ripgrep`).

## Architecture

- **Hybrid Filesystem**: Standard operations (read/write/directory listing) are performed locally on a mounted remote folder, ensuring zero network lag for common IDE tasks.
- **Remote Search Daemon**: A Python 3.12+ backend running on the server, leveraging `ripgrep` to perform blazing fast global searches and streaming results back to VS Code via WebSockets.

## Features

- [x] **Hybrid IO**: Blazing fast file access via local mount (NFS/SSHFS).
- [x] **Remote Search**: Deep project search using `ripgrep` on the server.
- [x] **Dual Path Mapping**: Map high-level remote paths to specific local mount points per workspace folder.
- [x] **Streaming Results**: Search results appear in real-time as they are found.
- [x] **Lazy Initialization**: Minimal overhead, daemon connection only starts when needed.

## Installation

### 1. Setup Daemon (on Server)

```bash
cd daemon
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Install ripgrep
The daemon requires `ripgrep` (`rg`) to be installed and in the server's `$PATH`.
```bash
sudo apt install ripgrep
```

### 3. Run Daemon
```bash
python3 -m app.main
```

## Mounting the Remote Filesystem

RemoteFS works best when your remote project folder is mounted locally.

### Via NFS (Recommended for Performance)
```bash
sudo mount -t nfs <server-ip>:/var/www/project /mnt/nfs/project
```

### Via SSHFS
```bash
sshfs user@<server-ip>:/var/www/project /mnt/nfs/project
```

## Usage

### Direct Setup
1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run `RemoteFS: Setup Connection`.
3. Follow the prompts to enter Host, Port, Remote Path, and Local Mount Path.

### CLI One-Liner
Open a remote workspace directly from your terminal with custom connection settings:
```bash
code --folder-uri "remotefs:/mnt/nfs/project?remote=/var/www/remote-project&host=10.0.0.1&port=8765"
```

## Configuration

Settings are managed in VS Code settings under `remotefs.*`:
- `remotefs.host`: Daemon host address (default: `localhost`).
- `remotefs.port`: Daemon port (default: `8765`).

## Requirements

- **Server**: Python 3.12+, `ripgrep`.
- **Client**: VS Code 1.85.0+.
- **Mount**: NFS or SSHFS recommended for optimal file IO performance.
