import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteFileSearchProvider {
    constructor(private getClient: () => RPCClient | undefined) {}

    private getRemotePath(uri: vscode.Uri): string {
        const query = uri.query;
        if (query) {
            const params = new URLSearchParams(query);
            const remote = params.get('remote');
            if (remote) {
                return remote;
            }
        }
        return uri.path;
    }

    async provideFileSearchResults(options: any, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
        const client = this.getClient();
        if (!client) {
            return [];
        }

        const remotePath = this.getRemotePath(options.folder);
        const localPath = options.folder.path;

        try {
            const res = await client.call('fileSearch', {
                pattern: options.query,
                path: remotePath
            });
            
            return res.files.map((file: string) => {
                 // Map remote path back to local path for VS Code
                 const relativePath = file.startsWith(remotePath) 
                    ? file.substring(remotePath.length) 
                    : file;
                const finalPath = localPath + (relativePath.startsWith('/') ? relativePath : '/' + relativePath);
                return options.folder.with({ path: finalPath });
            });
        } catch (err) {
            return [];
        }
    }
}
