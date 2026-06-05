import * as assert from 'assert';
import * as vscode from 'vscode';

suite('RemoteFS Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok((vscode.extensions as any).getExtension('naumanahmed.remotefs'));
    });

    test('Should register remotefs filesystem provider', async () => {
        // We can't easily test the provider logic without a running daemon
        // but we can check if it's registered.
        const uri = vscode.Uri.parse('remotefs:/test');
        try {
            await vscode.workspace.fs.stat(uri);
        } catch (err: any) {
            // It should at least try to use our provider
            // If it's NOT registered, we'd get a "No file system provider found" error
            assert.notStrictEqual(err.message, 'No file system provider found for remotefs');
        }
    });
});
