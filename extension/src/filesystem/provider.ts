import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteFSProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    private client: RPCClient;

    constructor() {
        // In a real scenario, this URL might be configurable
        this.client = new RPCClient('ws://localhost:8765/ws');
    }

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
        // Will be implemented in Phase 3
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const res = await this.client.call('stat', { path: uri.path });
        return {
            type: res.type,
            ctime: res.ctime,
            mtime: res.mtime,
            size: res.size
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const res = await this.client.call('readDirectory', { path: uri.path });
        return res.entries.map((entry: any) => [entry.name, entry.type]);
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        // Will be implemented in Phase 3
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const res = await this.client.call('readFile', { path: uri.path });
        return Buffer.from(res.content, 'base64');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
        const contentBase64 = Buffer.from(content).toString('base64');
        await this.client.call('writeFile', { path: uri.path, content: contentBase64 });
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean }): void | Thenable<void> {
        // Will be implemented in Phase 3
    }

    rename(uri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
        // Will be implemented in Phase 3
    }
}
