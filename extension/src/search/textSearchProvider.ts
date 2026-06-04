import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';

export class RemoteTextSearchProvider {
    constructor(private getClient: () => RPCClient | undefined) {}

    async provideTextSearchResults(query: any, options: any, progress: vscode.Progress<any>, token: vscode.CancellationToken): Promise<any> {
        const client = this.getClient();
        if (!client) {
            return { limitHit: false, message: { text: 'Client not initialized', type: 1 } };
        }

        const payload = {
            pattern: query.pattern,
            path: options.folder.path,
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
                    progress.report({
                        uri: vscode.Uri.parse(`remotefs:${match.path}`),
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
