import * as vscode from 'vscode';

import { FilesystemAdapter } from '../adapters/filesystemAdapter';

import {
    DEFAULT_FILESYSTEM_FEATURE_FLAGS,
    FilesystemFeatureFlags
} from './featureFlags';

export class OperationRouter {
    constructor(
        private readonly localAdapter: FilesystemAdapter,

        private readonly remoteAdapter: FilesystemAdapter
    ) {}

    private getFlags(): FilesystemFeatureFlags {
        return vscode.workspace
            .getConfiguration('remotefs')
            .get<FilesystemFeatureFlags>(
                'features',
                DEFAULT_FILESYSTEM_FEATURE_FLAGS
            );
    }

    public getAdapter(
        operation: keyof FilesystemFeatureFlags,
        uri?: vscode.Uri
    ): FilesystemAdapter {
        const flags = this.getFlags();

        const mode = flags[operation];

        switch (mode) {
            case 'local':
                return this.localAdapter;

            case 'remote':
                return this.remoteAdapter;

            case 'hybrid':
                return this.resolveHybridAdapter(
                    operation,
                    uri
                );

            default:
                return this.localAdapter;
        }
    }

    private resolveHybridAdapter(
        operation: keyof FilesystemFeatureFlags,
        uri?: vscode.Uri
    ): FilesystemAdapter {
        /**
         * Future intelligent routing:
         *
         * - node_modules -> local
         * - src -> remote
         * - large files -> local
         * - offline -> local
         * - cache aware
         */

        return this.remoteAdapter;
    }
}
