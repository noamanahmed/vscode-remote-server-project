import * as vscode from 'vscode';

import { RPCClient } from '../rpc/client';

import { logger } from '../logger';

import { LocalFilesystemAdapter } from './adapters/localAdapter';
import { RemoteFilesystemAdapter } from './adapters/remoteAdapter';

import { OperationRouter } from './routing/operationRouter';

import { parseRemoteFSUri } from './routing/parseRemoteFSUri';

export class RemoteFSProvider
    implements vscode.FileSystemProvider
{
    private readonly _onDidChangeFile =
        new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    readonly onDidChangeFile =
        this._onDidChangeFile.event;

    /**
     * RPC clients keyed by:
     * ws://host:port/ws
     */
    private readonly clients =
        new Map<string, RPCClient>();

    /**
     * Adapters
     */
    private readonly localAdapter =
        new LocalFilesystemAdapter();

    private readonly remoteAdapter =
        new RemoteFilesystemAdapter(
            (uri) => this.getClient(uri)
        );

    /**
     * Router
     */
    private readonly router =
        new OperationRouter(
            this.localAdapter,
            this.remoteAdapter
        );

    constructor() {
        logger.info(
            'RemoteFSProvider initialized'
        );

        /**
         * Configuration watcher
         */
        vscode.workspace.onDidChangeConfiguration(
            (event) => {
                if (
                    event.affectsConfiguration(
                        'remotefs'
                    )
                ) {
                    logger.info(
                        'RemoteFS configuration updated'
                    );
                }
            }
        );
    }

    /**
     * Resolve RPC client from URI
     */
    public getClient(
        uri: vscode.Uri
    ): RPCClient {
        const parsed = parseRemoteFSUri(uri);

        const url =
            `ws://${parsed.host}:${parsed.port}/ws`;

        let client = this.clients.get(url);

        if (!client) {
            logger.info(
                `Creating RPC client ${url}`
            );

            client = new RPCClient(
                url,
                parsed.token ?? ''
            );

            this.clients.set(url, client);
        } else {
            /**
             * Allow dynamic token refresh
             */
            client.setUrl(
                url,
                parsed.token ?? ''
            );
        }

        return client;
    }

    /**
     * Manual connectivity test
     */
    public async testConnection(
        uri?: vscode.Uri
    ): Promise<void> {
        try {
            const targetUri =
                uri
                ?? vscode.Uri.parse(
                    'remotefs:/'
                );

            const client =
                this.getClient(targetUri);

            await client.connect();

            logger.info(
                'RemoteFS connection test successful'
            );
        } catch (err: any) {
            logger.error(
                `Connection test failed: ${
                    err?.message ?? err
                }`
            );

            throw err;
        }
    }

    /**
     * Watcher
     *
     * Future:
     * - remote subscriptions
     * - websocket change events
     * - local fs.watch bridge
     */
    watch(
        uri: vscode.Uri,
        options: {
            readonly recursive: boolean;

            readonly excludes: readonly string[];
        }
    ): vscode.Disposable {
        logger.info(
            `watch ${uri.toString()}`
        );

        return new vscode.Disposable(() => {
            logger.info(
                `dispose watch ${uri.toString()}`
            );
        });
    }

    /**
     * stat
     */
    async stat(
        uri: vscode.Uri
    ): Promise<vscode.FileStat> {
        return this.router
            .getAdapter('stat', uri)
            .stat(uri);
    }

    /**
     * readDirectory
     */
    async readDirectory(
        uri: vscode.Uri
    ): Promise<[string, vscode.FileType][]> {
        return this.router
            .getAdapter(
                'readDirectory',
                uri
            )
            .readDirectory(uri);
    }

    /**
     * readFile
     */
    async readFile(
        uri: vscode.Uri
    ): Promise<Uint8Array> {
        return this.router
            .getAdapter(
                'readFile',
                uri
            )
            .readFile(uri);
    }

    /**
     * writeFile
     */
    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: {
            readonly create: boolean;

            readonly overwrite: boolean;
        }
    ): Promise<void> {
        await this.router
            .getAdapter(
                'writeFile',
                uri
            )
            .writeFile(
                uri,
                content,
                options
            );

        this.fireFileChangeEvent(
            vscode.FileChangeType.Changed,
            uri
        );
    }

    /**
     * createDirectory
     */
    async createDirectory(
        uri: vscode.Uri
    ): Promise<void> {
        await this.router
            .getAdapter(
                'createDirectory',
                uri
            )
            .createDirectory(uri);

        this.fireFileChangeEvent(
            vscode.FileChangeType.Created,
            uri
        );
    }

    /**
     * delete
     */
    async delete(
        uri: vscode.Uri,
        options: {
            readonly recursive: boolean;
        }
    ): Promise<void> {
        await this.router
            .getAdapter(
                'delete',
                uri
            )
            .delete(
                uri,
                options
            );

        this.fireFileChangeEvent(
            vscode.FileChangeType.Deleted,
            uri
        );
    }

    /**
     * rename
     */
    async rename(
        uri: vscode.Uri,
        newUri: vscode.Uri,
        options: {
            readonly overwrite: boolean;
        }
    ): Promise<void> {
        await this.router
            .getAdapter(
                'rename',
                uri
            )
            .rename(
                uri,
                newUri,
                options
            );

        this.fireFileChangeEvent(
            vscode.FileChangeType.Deleted,
            uri
        );

        this.fireFileChangeEvent(
            vscode.FileChangeType.Created,
            newUri
        );
    }

    /**
     * Emit filesystem change event
     */
    private fireFileChangeEvent(
        type: vscode.FileChangeType,
        uri: vscode.Uri
    ): void {
        this._onDidChangeFile.fire([
            {
                type,
                uri
            }
        ]);
    }

    /**
     * Dispose all RPC clients
     */
    public dispose(): void {
        logger.info(
            'Disposing RemoteFSProvider'
        );

        for (const client of this.clients.values()) {
            try {
                client.dispose?.();
            } catch (err: any) {
                logger.error(
                    `Failed to dispose client: ${
                        err?.message ?? err
                    }`
                );
            }
        }

        this.clients.clear();

        this._onDidChangeFile.dispose();
    }
}