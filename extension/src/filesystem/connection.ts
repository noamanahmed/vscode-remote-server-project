import * as vscode from 'vscode';

export interface ConnectionParams {
    host: string;
    port: number;
    token: string;
}

/**
 * The daemon now serves a single root folder (its --folder argument), so the
 * extension no longer encodes local/remote paths in the URI. Connection params
 * come purely from configuration. The path within the served root is simply
 * uri.path.
 */
export function getConnectionParams(): ConnectionParams {
    const config = vscode.workspace.getConfiguration('remotefs');
    return {
        host: config.get<string>('host', 'localhost'),
        port: config.get<number>('port', 8765),
        token: config.get<string>('token', '')
    };
}

export function getDaemonUrl(params: ConnectionParams): string {
    return `ws://${params.host}:${params.port}/ws`;
}

/**
 * Root-relative path the daemon expects for a given remotefs URI.
 * remotefs:/src/app.ts -> "/src/app.ts"; the root itself -> "/".
 */
export function remotePath(uri: vscode.Uri): string {
    return uri.path && uri.path !== '' ? uri.path : '/';
}
