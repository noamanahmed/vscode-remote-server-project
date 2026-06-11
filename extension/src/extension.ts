import * as vscode from 'vscode';
import { RemoteFSProvider } from './filesystem/provider';
import { RemoteTextSearchProvider } from './search/textSearchProvider';
import { RemoteFileSearchProvider } from './search/fileSearchProvider';
import { openRemoteTerminal } from './terminal/remoteTerminal';
import { logger } from './logger';

const ROOT_URI = vscode.Uri.from({ scheme: 'remotefs', path: '/' });

export function activate(context: vscode.ExtensionContext) {
    try {
        logger.info('RemoteFS extension activating...');

        // Keep network lazy — no client created during activation.
        const remoteFSProvider = new RemoteFSProvider();
        context.subscriptions.push(remoteFSProvider);

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('remotefs', remoteFSProvider, {
                isCaseSensitive: true,
                isReadonly: false
            })
        );

        const getClient = (uri: vscode.Uri) => remoteFSProvider.getClient(uri);

        context.subscriptions.push(
            (vscode.workspace as any).registerTextSearchProvider(
                'remotefs',
                new RemoteTextSearchProvider(getClient)
            )
        );
        context.subscriptions.push(
            (vscode.workspace as any).registerFileSearchProvider(
                'remotefs',
                new RemoteFileSearchProvider(getClient)
            )
        );

        /**
         * Connect: open the daemon's served root as a workspace folder.
         * The daemon decides which folder it serves (its --folder argument),
         * so there are no local/remote path prompts anymore.
         */
        context.subscriptions.push(
            vscode.commands.registerCommand('remotefs.connect', async () => {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'RemoteFS: Connecting...',
                        cancellable: false
                    },
                    async () => {
                        try {
                            const info = await remoteFSProvider.init(ROOT_URI);
                            const name = info?.name ? `Remote: ${info.name}` : 'Remote';
                            vscode.workspace.updateWorkspaceFolders(
                                vscode.workspace.workspaceFolders?.length || 0,
                                0,
                                { uri: ROOT_URI, name }
                            );
                            vscode.window.showInformationMessage(`RemoteFS: Connected to ${name}`);
                        } catch (err: any) {
                            logger.error(`connect failed: ${err?.message ?? err}`);
                            vscode.window.showErrorMessage(`RemoteFS: Connect failed: ${err?.message ?? err}`);
                            logger.show();
                        }
                    }
                );
            })
        );

        /**
         * Setup Connection: configure host/port/token, then connect.
         */
        context.subscriptions.push(
            vscode.commands.registerCommand('remotefs.setupConnection', async () => {
                try {
                    const config = vscode.workspace.getConfiguration('remotefs');

                    const host = await vscode.window.showInputBox({
                        prompt: 'Enter Daemon Host',
                        value: config.get<string>('host', 'localhost')
                    });
                    if (host === undefined) return;

                    const portStr = await vscode.window.showInputBox({
                        prompt: 'Enter Daemon Port',
                        value: config.get<number>('port', 8765).toString()
                    });
                    if (portStr === undefined) return;

                    const token = await vscode.window.showInputBox({
                        prompt: 'Enter Daemon Token',
                        value: config.get<string>('token', ''),
                        password: true
                    });
                    if (token === undefined) return;

                    await config.update('host', host, vscode.ConfigurationTarget.Global);
                    await config.update('port', parseInt(portStr), vscode.ConfigurationTarget.Global);
                    await config.update('token', token, vscode.ConfigurationTarget.Global);

                    await vscode.commands.executeCommand('remotefs.connect');
                } catch (err: any) {
                    logger.error(`setupConnection failed: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage('Failed to setup connection');
                }
            })
        );

        /**
         * Test Connection.
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
                            await remoteFSProvider.testConnection(ROOT_URI);
                            vscode.window.showInformationMessage('RemoteFS: Connection successful!');
                        } catch (err: any) {
                            logger.error(`Connection test failed: ${err?.message ?? err}`);
                            vscode.window.showErrorMessage(`RemoteFS: Connection failed: ${err?.message ?? err}`);
                            logger.show();
                        }
                    }
                );
            })
        );

        /**
         * Open Terminal: a real shell on the remote server.
         */
        context.subscriptions.push(
            vscode.commands.registerCommand('remotefs.openTerminal', async () => {
                try {
                    const client = remoteFSProvider.getClient(ROOT_URI);
                    await client.connect();
                    const info = await remoteFSProvider.init(ROOT_URI).catch(() => undefined);
                    openRemoteTerminal(client, info?.name ? `Remote: ${info.name}` : 'Remote');
                } catch (err: any) {
                    logger.error(`openTerminal failed: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`RemoteFS: Failed to open terminal: ${err?.message ?? err}`);
                }
            })
        );

        logger.info('RemoteFS extension activated successfully');
    } catch (err: any) {
        console.error('RemoteFS activation crash:', err);
        vscode.window.showErrorMessage(`RemoteFS failed to activate: ${err?.message ?? err}`);
    }
}

export function deactivate() {
    logger.dispose();
}
