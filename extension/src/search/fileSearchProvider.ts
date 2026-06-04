import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteFileSearchProvider {
    constructor(private client: RPCClient) {}

    async provideFileSearchResults(options: any, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
        try {
            const res = await this.client.call('fileSearch', {
                pattern: options.query,
                path: options.folder.path
            });
            
            return res.files.map((file: string) => vscode.Uri.parse(`remotefs:${file}`));
        } catch (err) {
            return [];
        }
    }
}
