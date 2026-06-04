import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

    private toLocalPath(uri: vscode.Uri): string {
        return uri.path;
    }

    public getClient(): RPCClient {
        return this.client;
    }

    public async testConnection(): Promise<void> {
        await this.client.connect();
    }

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const localPath = this.toLocalPath(uri);
        logger.info(`stat (local): ${localPath}`);
        
        try {
            const stats = await fs.promises.stat(localPath);
            return {
                type: stats.isFile() ? vscode.FileType.File : stats.isDirectory() ? vscode.FileType.Directory : vscode.FileType.Unknown,
                ctime: stats.ctimeMs,
                mtime: stats.mtimeMs,
                size: stats.size
            };
        } catch (err: any) {
            logger.error(`stat failed for ${localPath}: ${err.message}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const localPath = this.toLocalPath(uri);
        logger.info(`readDirectory (local): ${localPath}`);
        
        try {
            const entries = await fs.promises.readdir(localPath, { withFileTypes: true });
            return entries.map(entry => {
                const type = entry.isFile() ? vscode.FileType.File : entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.Unknown;
                return [entry.name, type];
            });
        } catch (err: any) {
            logger.error(`readDirectory failed for ${localPath}: ${err.message}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const localPath = this.toLocalPath(uri);
        logger.info(`readFile (local): ${localPath}`);
        
        try {
            const content = await fs.promises.readFile(localPath);
            return new Uint8Array(content);
        } catch (err: any) {
            logger.error(`readFile failed for ${localPath}: ${err.message}`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
        const localPath = this.toLocalPath(uri);
        logger.info(`writeFile (local): ${localPath}`);
        
        try {
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }
            await fs.promises.writeFile(localPath, content);
        } catch (err: any) {
            logger.error(`writeFile failed for ${localPath}: ${err.message}`);
            throw err;
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const localPath = this.toLocalPath(uri);
        logger.info(`createDirectory (local): ${localPath}`);
        await fs.promises.mkdir(localPath, { recursive: true });
    }

    async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
        const localPath = this.toLocalPath(uri);
        logger.info(`delete (local): ${localPath}`);
        await fs.promises.rm(localPath, { recursive: options.recursive });
    }

    async rename(uri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): Promise<void> {
        const oldPath = this.toLocalPath(uri);
        const newPath = this.toLocalPath(newUri);
        logger.info(`rename (local): ${oldPath} -> ${newPath}`);
        await fs.promises.rename(oldPath, newPath);
    }
}
