import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';
import { remotePath } from '../filesystem/connection';
import { logger } from '../logger';

export class RemoteFileSearchProvider {
    constructor(private getClient: (uri: vscode.Uri) => RPCClient) {}

    /**
     * The fileSearchProvider proposal has shifted shape across VS Code
     * versions. Current (1.85+) signature is:
     *   provideFileSearchResults(query: {pattern}, options: {folder,...}, token)
     * Older builds passed a single combined options object first. Resolve both
     * defensively so Quick Open (Ctrl+P) works regardless of the host version.
     */
    async provideFileSearchResults(arg1: any, arg2: any, arg3?: any): Promise<vscode.Uri[]> {
        let folder: vscode.Uri | undefined;
        let pattern = '';

        if (arg2 && arg2.folder) {
            // New shape: (query, options, token)
            folder = arg2.folder;
            pattern = (arg1 && arg1.pattern) ?? arg2.query ?? '';
        } else if (arg1 && arg1.folder) {
            // Old shape: (options, token)
            folder = arg1.folder;
            pattern = arg1.query ?? arg1.pattern ?? '';
        }

        if (!folder) {
            logger.error('fileSearch: could not resolve workspace folder from arguments');
            return [];
        }

        const client = this.getClient(folder);
        if (!client) {
            return [];
        }

        try {
            const res = await client.call('fileSearch', {
                pattern,
                path: remotePath(folder)
            });

            // Daemon returns root-relative paths; map straight onto the folder.
            return (res.files ?? []).map((file: string) => folder!.with({ path: file }));
        } catch (err) {
            logger.error(`fileSearch failed: ${err}`);
            return [];
        }
    }
}
