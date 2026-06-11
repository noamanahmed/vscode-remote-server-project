import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';
import { remotePath } from '../filesystem/connection';

export class RemoteFileSearchProvider {
    constructor(private getClient: (uri: vscode.Uri) => RPCClient) {}

    async provideFileSearchResults(options: any, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
        const client = this.getClient(options.folder);
        if (!client) {
            return [];
        }

        try {
            const res = await client.call('fileSearch', {
                pattern: options.query,
                path: remotePath(options.folder)
            });

            // Daemon returns root-relative paths; map straight onto the folder.
            return (res.files ?? []).map((file: string) =>
                options.folder.with({ path: file })
            );
        } catch (err) {
            return [];
        }
    }
}
