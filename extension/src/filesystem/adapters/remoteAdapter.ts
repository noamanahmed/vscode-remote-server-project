import * as vscode from 'vscode';

import { FilesystemAdapter } from './filesystemAdapter';
import { RPCClient } from '../../rpc/client';
import { logger } from '../../logger';

export class RemoteFilesystemAdapter
    implements FilesystemAdapter
{
    constructor(
        private readonly getClient: (
            uri: vscode.Uri
        ) => RPCClient
    ) {}

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        logger.info(`[remote] stat ${uri.path}`);

        const client = this.getClient(uri);

        return client.call('fs.stat', {
            path: uri.path
        });
    }

    async readDirectory(
        uri: vscode.Uri
    ): Promise<[string, vscode.FileType][]> {
        logger.info(`[remote] readDirectory ${uri.path}`);

        const client = this.getClient(uri);

        return client.call('fs.readDirectory', {
            path: uri.path
        });
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        logger.info(`[remote] readFile ${uri.path}`);

        const client = this.getClient(uri);

        const response = await client.call(
            'fs.readFile',
            {
                path: uri.path
            }
        );

        return Uint8Array.from(response.data);
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: {
            readonly create: boolean;
            readonly overwrite: boolean;
        }
    ): Promise<void> {
        logger.info(`[remote] writeFile ${uri.path}`);

        const client = this.getClient(uri);

        await client.call('fs.writeFile', {
            path: uri.path,

            content: Array.from(content),

            options
        });
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        logger.info(`[remote] createDirectory ${uri.path}`);

        const client = this.getClient(uri);

        await client.call('fs.createDirectory', {
            path: uri.path
        });
    }

    async delete(
        uri: vscode.Uri,
        options: {
            readonly recursive: boolean;
        }
    ): Promise<void> {
        logger.info(`[remote] delete ${uri.path}`);

        const client = this.getClient(uri);

        await client.call('fs.delete', {
            path: uri.path,

            options
        });
    }

    async rename(
        uri: vscode.Uri,
        newUri: vscode.Uri,
        options: {
            readonly overwrite: boolean;
        }
    ): Promise<void> {
        logger.info(
            `[remote] rename ${uri.path} -> ${newUri.path}`
        );

        const client = this.getClient(uri);

        await client.call('fs.rename', {
            oldPath: uri.path,

            newPath: newUri.path,

            options
        });
    }
}
