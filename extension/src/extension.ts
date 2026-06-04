import * as vscode from 'vscode';
import { RemoteFSProvider } from './filesystem/provider';

export function activate(context: vscode.ExtensionContext) {
    console.log('RemoteFS extension is now active');

    const remoteFSProvider = new RemoteFSProvider();
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('remotefs', remoteFSProvider, {
            isCaseSensitive: true,
            isReadonly: false
        })
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
}

export function deactivate() {}
