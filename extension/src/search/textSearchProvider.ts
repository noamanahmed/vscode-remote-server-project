import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteTextSearchProvider {
    constructor(private getClient: (uri: vscode.Uri) => RPCClient) {}

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

    async provideTextSearchResults(query: any, options: any, progress: vscode.Progress<any>, token: vscode.CancellationToken): Promise<any> {
        const client = this.getClient(options.folder);
        if (!client) {
            return { limitHit: false, message: { text: 'Client not initialized', type: 1 } };
        }

        const remotePath = this.getRemotePath(options.folder);
        const localPath = options.folder.path;

        const payload = {
            pattern: query.pattern,
            path: remotePath,
            options: {
                isRegexp: query.isRegexp,
                caseSensitive: query.isCaseSensitive,
                wholeWord: query.isWordMatch,
                includes: options.includes,
                excludes: options.excludes
            }
        };

        try {
            for await (const result of client.stream('search', payload)) {
                if (token.isCancellationRequested) {
                    break;
                }
                
                if (result.type === 'searchResult') {
                    const match = result.payload;
                    // Map remote path back to local path for VS Code
                    const relativePath = match.path.startsWith(remotePath) 
                        ? match.path.substring(remotePath.length) 
                        : match.path;
                    const finalPath = localPath + (relativePath.startsWith('/') ? relativePath : '/' + relativePath);

                    progress.report({
                        uri: options.folder.with({ path: finalPath }),
                        ranges: new vscode.Range(match.line - 1, match.column, match.line - 1, match.column + query.pattern.length),
                        preview: {
                            text: match.text,
                            matches: new vscode.Range(0, match.column, 0, match.column + query.pattern.length)
                        }
                    });
                }
            }
            return { limitHit: false };
        } catch (err) {
            return { limitHit: false, message: { text: String(err), type: 1 /* Error */ } };
        }
    }
}
