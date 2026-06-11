import * as vscode from 'vscode';

export interface ConnectionParams {
    host: string;
    port: number;
    token: string;
}

/**
 * Connection params supplied at launch time via the workspace folder URI query
 * (e.g. `code --folder-uri "remotefs:/?host=..&port=..&token=.."`). These take
 * precedence over settings so the one-liner is self-contained, without having
 * to thread the query through every child resource URI.
 */
let seeded: Partial<ConnectionParams> = {};

export function setSeededParams(params: Partial<ConnectionParams>): void {
    seeded = { ...seeded, ...params };
}

/**
 * Parse host/port/token from a workspace folder URI's query string, if present.
 */
export function parseSeedFromUri(uri: vscode.Uri): Partial<ConnectionParams> {
    if (!uri.query) {
        return {};
    }
    const params = new URLSearchParams(uri.query);
    const out: Partial<ConnectionParams> = {};
    const host = params.get('host');
    const port = params.get('port');
    const token = params.get('token');
    if (host) out.host = host;
    if (port) out.port = parseInt(port, 10);
    if (token !== null) out.token = decodeURIComponent(token);
    return out;
}

/**
 * The daemon now serves a single root folder (its --folder argument), so the
 * extension no longer encodes local/remote paths in the URI. Connection params
 * come from the launch-time seed first, then configuration. The path within the
 * served root is simply uri.path.
 */
export function getConnectionParams(): ConnectionParams {
    const config = vscode.workspace.getConfiguration('remotefs');
    return {
        host: seeded.host ?? config.get<string>('host', 'localhost'),
        port: seeded.port ?? config.get<number>('port', 8765),
        token: seeded.token ?? config.get<string>('token', '')
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
