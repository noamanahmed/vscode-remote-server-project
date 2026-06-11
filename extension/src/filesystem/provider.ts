import * as vscode from 'vscode';

import { RPCClient, RPCResponse } from '../rpc/client';
import { logger } from '../logger';
import { getConnectionParams, getDaemonUrl, remotePath } from './connection';
import { StaleTracker, Fingerprint } from './staleCheck';

export class RemoteFSProvider implements vscode.FileSystemProvider {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    /** RPC clients keyed by ws://host:port/ws. Effectively one daemon. */
    private readonly clients = new Map<string, RPCClient>();
    private readonly wiredClients = new Set<string>();

    /** Root-relative directories the user currently has expanded. */
    private readonly expandedDirs = new Set<string>();
    private expandedSyncTimer: NodeJS.Timeout | null = null;

    private readonly staleTracker: StaleTracker;

    constructor() {
        logger.info('RemoteFSProvider initialized');
        this.staleTracker = new StaleTracker(
            (uri) => this.tryGetClient(uri),
            (uri) => this.fireFileChangeEvent(vscode.FileChangeType.Changed, uri)
        );
    }

    // --- client management ----------------------------------------------
    public getClient(uri: vscode.Uri): RPCClient {
        const params = getConnectionParams();
        const url = getDaemonUrl(params);

        let client = this.clients.get(url);
        if (!client) {
            logger.info(`Creating RPC client ${url}`);
            client = new RPCClient(url, params.token ?? '');
            this.clients.set(url, client);
        } else {
            client.setUrl(url, params.token ?? '');
        }

        if (!this.wiredClients.has(url)) {
            this.wireClient(client);
            this.wiredClients.add(url);
        }
        return client;
    }

    private tryGetClient(uri: vscode.Uri): RPCClient | undefined {
        try {
            return this.getClient(uri);
        } catch {
            return undefined;
        }
    }

    /** Attach server-event and reconnect handling to a client (once). */
    private wireClient(client: RPCClient): void {
        client.onEvent((event) => this.handleServerEvent(event));
        client.onReconnect(() => {
            logger.info('Daemon reconnected; refreshing tree and resyncing expanded dirs');
            this.syncExpandedDirs(client, true);
            // Force VS Code to re-read the root after a gap.
            this.fireFileChangeEvent(vscode.FileChangeType.Changed, this.rootUri());
        });
    }

    private rootUri(): vscode.Uri {
        return vscode.Uri.from({ scheme: 'remotefs', path: '/' });
    }

    private uriForRel(relPath: string): vscode.Uri {
        return vscode.Uri.from({ scheme: 'remotefs', path: relPath || '/' });
    }

    // --- server-pushed events -------------------------------------------
    private handleServerEvent(event: RPCResponse): void {
        switch (event.type) {
            case 'fs.changed':
                this.onFsChanged(event.payload?.events ?? []);
                break;
            case 'git.branchChanged':
                this.onBranchChanged(event.payload);
                break;
            // terminal.* events are consumed by the terminal client, not here.
        }
    }

    private onFsChanged(events: Array<{ type: string; path: string }>): void {
        const changes: vscode.FileChangeEvent[] = events.map((e) => ({
            type:
                e.type === 'created' ? vscode.FileChangeType.Created :
                e.type === 'deleted' ? vscode.FileChangeType.Deleted :
                vscode.FileChangeType.Changed,
            uri: this.uriForRel(e.path)
        }));
        if (changes.length) {
            this._onDidChangeFile.fire(changes);
        }
    }

    private onBranchChanged(payload: any): void {
        logger.info(`Branch changed to ${payload?.branch}; refreshing tree`);
        const changes: vscode.FileChangeEvent[] = [
            { type: vscode.FileChangeType.Changed, uri: this.rootUri() }
        ];
        const expanded = payload?.expanded ?? {};
        for (const rel of Object.keys(expanded)) {
            changes.push({ type: vscode.FileChangeType.Changed, uri: this.uriForRel(rel) });
        }
        this._onDidChangeFile.fire(changes);
    }

    // --- expanded-dir tracking ------------------------------------------
    private trackExpanded(relPath: string): void {
        if (relPath === '/' || this.expandedDirs.has(relPath)) {
            return;
        }
        this.expandedDirs.add(relPath);
        const client = this.tryGetClient(this.rootUri());
        if (client) {
            this.syncExpandedDirs(client, false);
        }
    }

    private syncExpandedDirs(client: RPCClient, immediate: boolean): void {
        if (this.expandedSyncTimer) {
            clearTimeout(this.expandedSyncTimer);
            this.expandedSyncTimer = null;
        }
        const send = () => {
            client.call('expandedDirs', { paths: Array.from(this.expandedDirs) })
                .catch((err) => logger.error(`expandedDirs sync failed: ${err?.message ?? err}`));
        };
        if (immediate) {
            send();
        } else {
            this.expandedSyncTimer = setTimeout(send, 250);
        }
    }

    public async testConnection(uri?: vscode.Uri): Promise<void> {
        const client = this.getClient(uri ?? this.rootUri());
        await client.connect();
        logger.info('RemoteFS connection test successful');
    }

    /** Returns the daemon's init payload (root name, branch, warmed tree). */
    public async init(uri?: vscode.Uri): Promise<any> {
        const client = this.getClient(uri ?? this.rootUri());
        return client.call('init', {});
    }

    // --- FileSystemProvider ---------------------------------------------
    watch(uri: vscode.Uri): vscode.Disposable {
        // Watching is global on the daemon side (one recursive watcher pushes
        // fs.changed for the whole root). Ensure the client is connected so the
        // event stream is live; nothing to tear down per-watch.
        try {
            this.getClient(uri).connect().catch(() => undefined);
        } catch { /* ignore */ }
        return new vscode.Disposable(() => undefined);
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const res = await this.getClient(uri).call('stat', { path: remotePath(uri) });
        return {
            type: res.type as vscode.FileType,
            ctime: res.ctime,
            mtime: res.mtime,
            size: res.size
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const rel = remotePath(uri);
        const res = await this.getClient(uri).call('readDirectory', { path: rel });
        this.trackExpanded(rel);
        return (res.entries ?? []).map(
            (e: any) => [e.name, e.type as vscode.FileType] as [string, vscode.FileType]
        );
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const res = await this.getClient(uri).call('readFile', { path: remotePath(uri) });
        this.staleTracker.recordBaseline(uri, res.fingerprint as Fingerprint | undefined);
        return new Uint8Array(Buffer.from(res.content, 'base64'));
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        _options: { readonly create: boolean; readonly overwrite: boolean }
    ): Promise<void> {
        await this.getClient(uri).call('writeFile', {
            path: remotePath(uri),
            content: Buffer.from(content).toString('base64')
        });
        this.fireFileChangeEvent(vscode.FileChangeType.Changed, uri);
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        await this.getClient(uri).call('createDirectory', { path: remotePath(uri) });
        this.fireFileChangeEvent(vscode.FileChangeType.Created, uri);
    }

    async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
        await this.getClient(uri).call('delete', {
            path: remotePath(uri),
            recursive: options.recursive
        });
        this.staleTracker.forget(uri);
        this.fireFileChangeEvent(vscode.FileChangeType.Deleted, uri);
    }

    async rename(
        uri: vscode.Uri,
        newUri: vscode.Uri,
        options: { readonly overwrite: boolean }
    ): Promise<void> {
        await this.getClient(uri).call('rename', {
            oldPath: remotePath(uri),
            newPath: remotePath(newUri),
            overwrite: options.overwrite
        });
        this.staleTracker.forget(uri);
        this.fireFileChangeEvent(vscode.FileChangeType.Deleted, uri);
        this.fireFileChangeEvent(vscode.FileChangeType.Created, newUri);
    }

    private fireFileChangeEvent(type: vscode.FileChangeType, uri: vscode.Uri): void {
        this._onDidChangeFile.fire([{ type, uri }]);
    }

    public dispose(): void {
        logger.info('Disposing RemoteFSProvider');
        for (const client of this.clients.values()) {
            try { client.dispose?.(); } catch (err: any) {
                logger.error(`Failed to dispose client: ${err?.message ?? err}`);
            }
        }
        this.clients.clear();
        this.wiredClients.clear();
        this.staleTracker.dispose();
        this._onDidChangeFile.dispose();
    }
}
