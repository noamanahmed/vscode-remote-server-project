import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteFileSearchProvider {
    constructor(private getClient: () => RPCClient | undefined) {}

    async provideFileSearchResults(options: any, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
        const client = this.getClient();
        if (!client) {
            return [];
        }

        try {
            const res = await client.call('fileSearch', {
                pattern: options.query,
                path: options.folder.path
            });
            
            return res.files.map((file: string) => vscode.Uri.parse(`remotefs:${file}`));
        } catch (err) {
            return [];
        }
    }
}
