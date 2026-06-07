import * as vscode from 'vscode';
import { ParsedRemoteFSUri } from './parsedRemoteFSUri';

export function parseRemoteFSUri(
    uri: vscode.Uri
): ParsedRemoteFSUri {
    const config = vscode.workspace.getConfiguration('remotefs');

    const params = new URLSearchParams(uri.query);

    const host =
        params.get('host')
        || config.get<string>('host', 'localhost');

    const port =
        parseInt(
            params.get('port')
            || String(config.get<number>('port', 8765)),
            10
        );

    const token =
        params.get('token')
        || config.get<string>('token', '');

    const remotePath =
        params.get('remote')
            ? decodeURIComponent(params.get('remote')!)
            : undefined;

    return {
        localPath: uri.path,
        remotePath,
        host,
        port,
        token
    };
}
