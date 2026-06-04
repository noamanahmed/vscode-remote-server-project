import * as vscode from 'vscode';
import * as path from 'path';
import { RemoteFSProvider } from './filesystem/provider';
import { RemoteTextSearchProvider } from './search/textSearchProvider';
import { RemoteFileSearchProvider } from './search/fileSearchProvider';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext) {
    try {
        logger.info('RemoteFS extension activating...');

        /**
         * IMPORTANT:
         * Do NOT initialize network clients here.
         * Keep everything lazy to avoid Extension Host crashes.
         */
        const remoteFSProvider = new RemoteFSProvider();

        /**
         * FileSystemProvider (core)
         */
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(
                'remotefs',
                remoteFSProvider,
                {
                    isCaseSensitive: true,
                    isReadonly: false
                }
            )
        );

        /**
         * Lazy client getter (safe pattern)
         * Providers should NOT connect to daemon in constructor.
         */
        const getClient = () => remoteFSProvider.getClient?.();

        /**
         * Text Search Provider
         */
        context.subscriptions.push(
            vscode.workspace.registerTextSearchProvider(
                'remotefs',
                new RemoteTextSearchProvider(getClient)
            )
        );

        /**
         * File Search Provider
         */
        context.subscriptions.push(
            vscode.workspace.registerFileSearchProvider(
                'remotefs',
                new RemoteFileSearchProvider(getClient)
            )
        );

        /**
         * Open workspace command
         */
        context.subscriptions.push(
            vscode.commands.registerCommand('remotefs.openWorkspace', async () => {
                try {
                    const remotePath = await vscode.window.showInputBox({
                        prompt: 'Enter absolute path on remote server',
                        placeHolder: '/var/www/remote-project'
                    });

                    if (!remotePath) {
                        return;
                    }

                    const localPath = await vscode.window.showInputBox({
                        prompt: 'Enter local mount path of the remote folder',
                        placeHolder: '/mnt/nfs/remote-project'
                    });

                    if (!localPath) {
                        return;
                    }

                    // Encode mapping in URI: remotefs:/local/mount?remote=/remote/path
                    const uri = vscode.Uri.parse(`remotefs:${localPath}`).with({
                        query: `remote=${encodeURIComponent(remotePath)}`
                    });

                    vscode.workspace.updateWorkspaceFolders(
                        vscode.workspace.workspaceFolders?.length || 0,
                        0,
                        {
                            uri,
                            name: `Remote: ${path.basename(remotePath)}`
                        }
                    );
                } catch (err: any) {
                    logger.error(`openWorkspace failed: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage('Failed to open workspace');
                }
            })
        );

        /**
         * Test connection command (lazy init safe)
         */
        context.subscriptions.push(
            vscode.commands.registerCommand('remotefs.testConnection', async () => {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'RemoteFS: Testing Connection...',
                        cancellable: false
                    },
                    async () => {
                        try {
                            const client = remoteFSProvider.getClient?.();

                            if (!client) {
                                throw new Error('Client not initialized');
                            }

                            await remoteFSProvider.testConnection();

                            vscode.window.showInformationMessage(
                                'RemoteFS: Connection successful!'
                            );

                            logger.info('Connection test successful');
                        } catch (err: any) {
                            logger.error(`Connection test failed: ${err?.message ?? err}`);
                            vscode.window.showErrorMessage(
                                `RemoteFS: Connection failed: ${err?.message ?? err}`
                            );

                            logger.show();
                        }
                    }
                );
            })
        );

        logger.info('RemoteFS extension activated successfully');
    } catch (err: any) {
        /**
         * CRITICAL:
         * Never allow activation to crash silently
         */
        console.error('RemoteFS activation crash:', err);
        vscode.window.showErrorMessage(
            `RemoteFS failed to activate: ${err?.message ?? err}`
        );
    }
}

export function deactivate() {
    logger.dispose();
}