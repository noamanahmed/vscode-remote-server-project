import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';
import { logger } from '../logger';

export class RemoteFSProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    private client: RPCClient;

    constructor() {
        const config = vscode.workspace.getConfiguration('remotefs');
        const host = config.get<string>('host', 'localhost');
        const port = config.get<number>('port', 8765);
        const url = `ws://${host}:${port}/ws`;
        
        this.client = new RPCClient(url);

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('remotefs.host') || e.affectsConfiguration('remotefs.port')) {
                const newConfig = vscode.workspace.getConfiguration('remotefs');
                const newHost = newConfig.get<string>('host', 'localhost');
                const newPort = newConfig.get<number>('port', 8765);
                const newUrl = `ws://${newHost}:${newPort}/ws`;
                this.client.setUrl(newUrl);
            }
        });
    }

    public async testConnection(): Promise<void> {
        await this.client.connect();
    }

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        logger.info(`stat: ${uri.path}`);
        const res = await this.client.call('stat', { path: uri.path });
        return {
            type: res.type,
            ctime: res.ctime,
            mtime: res.mtime,
            size: res.size
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        logger.info(`readDirectory: ${uri.path}`);
        const res = await this.client.call('readDirectory', { path: uri.path });
        return res.entries.map((entry: any) => [entry.name, entry.type]);
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        logger.info(`createDirectory: ${uri.path}`);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        logger.info(`readFile: ${uri.path}`);
        const res = await this.client.call('readFile', { path: uri.path });
        return Buffer.from(res.content, 'base64');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
        logger.info(`writeFile: ${uri.path}`);
        const contentBase64 = Buffer.from(content).toString('base64');
        await this.client.call('writeFile', { path: uri.path, content: contentBase64 });
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean }): void | Thenable<void> {
        logger.info(`delete: ${uri.path}`);
    }

    rename(uri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
        logger.info(`rename: ${uri.path} -> ${newUri.path}`);
    }
}
