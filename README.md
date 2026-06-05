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
python3 -m app.main --token your-secret-token
```
If the `--token` parameter is not provided, a random 32-character token will be generated and logged to the console.

## Auto-start on Boot

If the project is cloned to `/opt/vscode-remote-server-project`, you can use the provided startup scripts.

### For Systemd (Ubuntu, Debian, CentOS, etc.)

1. Edit `remotefs.service` if needed (it assumes `/opt/vscode-remote-server-project`).
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
code --folder-uri "remotefs:/mnt/nfs/project?remote=/var/www/remote-project&host=10.0.0.1&port=8765&token=your-secret-token"
```

## Configuration

Settings are managed in VS Code settings under `remotefs.*`:
- `remotefs.host`: Daemon host address (default: `localhost`).
- `remotefs.port`: Daemon port (default: `8765`).
- `remotefs.token`: Authentication token (default: `verySecureToken@Ooops`).

## Troubleshooting

If you see an error like `start-stop-daemon: ... does not exist`, please verify:
1. The project is cloned to the exact path specified (default: `/opt/vscode-remote-server-project`).
2. The virtual environment has been created: `cd daemon && python3 -m venv venv`.
3. You have copied the latest version of `remotefs.init` or `remotefs.service` to your system's init directory.
