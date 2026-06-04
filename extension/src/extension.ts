import * as vscode from 'vscode';
import { RemoteFSProvider } from './filesystem/provider';
import { RemoteTextSearchProvider } from './search/textSearchProvider';
import { RemoteFileSearchProvider } from './search/fileSearchProvider';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext) {
    logger.info('RemoteFS extension is now active');

    const remoteFSProvider = new RemoteFSProvider();
    const client = remoteFSProvider.getClient();
    
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('remotefs', remoteFSProvider, {
            isCaseSensitive: true,
            isReadonly: false
        })
    );

    context.subscriptions.push(
        (vscode.workspace as any).registerTextSearchProvider('remotefs', new RemoteTextSearchProvider(client) as any)
    );

    context.subscriptions.push(
        (vscode.workspace as any).registerFileSearchProvider('remotefs', new RemoteFileSearchProvider(client) as any)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('remotefs.openWorkspace', async () => {
            const path = await vscode.window.showInputBox({
                prompt: 'Enter absolute path on remote server',
                placeHolder: '/path/to/project'
            });

            if (path) {
                const uri = vscode.Uri.parse(`remotefs:${path}`);
                vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length || 0, 0, {
                    uri,
                    name: `Remote: ${path}`
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('remotefs.testConnection', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "RemoteFS: Testing Connection...",
                cancellable: false
            }, async () => {
                try {
                    await remoteFSProvider.testConnection();
                    vscode.window.showInformationMessage('RemoteFS: Connection successful!');
                    logger.info('Connection test successful');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`RemoteFS: Connection failed! ${err.message}`);
                    logger.error(`Connection test failed: ${err.message}`);
                    logger.show(); // Show log on failure
                }
            });
        })
    );
}

export function deactivate() {
    logger.dispose();
}
