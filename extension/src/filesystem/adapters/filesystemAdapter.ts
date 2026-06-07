import * as vscode from 'vscode';

export interface FilesystemAdapter {
    stat(uri: vscode.Uri): Promise<vscode.FileStat>;

    readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]>;

    readFile(uri: vscode.Uri): Promise<Uint8Array>;

    writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: {
            readonly create: boolean;
            readonly overwrite: boolean;
        }
    ): Promise<void>;

    createDirectory(uri: vscode.Uri): Promise<void>;

    delete(
        uri: vscode.Uri,
        options: {
            readonly recursive: boolean;
        }
    ): Promise<void>;

    rename(
        uri: vscode.Uri,
        newUri: vscode.Uri,
        options: {
            readonly overwrite: boolean;
        }
    ): Promise<void>;
}