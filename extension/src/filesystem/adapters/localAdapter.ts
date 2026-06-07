import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { FilesystemAdapter } from './filesystemAdapter';
import { logger } from '../../logger';

export class LocalFilesystemAdapter
    implements FilesystemAdapter
{
    private toLocalPath(uri: vscode.Uri): string {
        return uri.path;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] stat ${localPath}`);

        try {
            const stats = await fs.promises.stat(localPath);

            return {
                type: stats.isFile()
                    ? vscode.FileType.File
                    : stats.isDirectory()
                        ? vscode.FileType.Directory
                        : vscode.FileType.Unknown,

                ctime: stats.ctimeMs,

                mtime: stats.mtimeMs,

                size: stats.size
            };
        } catch (err: any) {
            logger.error(
                `[local] stat failed ${localPath}: ${err.message}`
            );

            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readDirectory(
        uri: vscode.Uri
    ): Promise<[string, vscode.FileType][]> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] readDirectory ${localPath}`);

        try {
            const entries = await fs.promises.readdir(
                localPath,
                {
                    withFileTypes: true
                }
            );

            return entries.map(entry => [
                entry.name,
                entry.isFile()
                    ? vscode.FileType.File
                    : entry.isDirectory()
                        ? vscode.FileType.Directory
                        : vscode.FileType.Unknown
            ]);
        } catch (err: any) {
            logger.error(
                `[local] readDirectory failed ${localPath}: ${err.message}`
            );

            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] readFile ${localPath}`);

        try {
            const content = await fs.promises.readFile(localPath);

            return new Uint8Array(content);
        } catch (err: any) {
            logger.error(
                `[local] readFile failed ${localPath}: ${err.message}`
            );

            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: {
            readonly create: boolean;
            readonly overwrite: boolean;
        }
    ): Promise<void> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] writeFile ${localPath}`);

        try {
            const dir = path.dirname(localPath);

            await fs.promises.mkdir(dir, {
                recursive: true
            });

            await fs.promises.writeFile(
                localPath,
                content
            );
        } catch (err: any) {
            logger.error(
                `[local] writeFile failed ${localPath}: ${err.message}`
            );

            throw err;
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] createDirectory ${localPath}`);

        await fs.promises.mkdir(localPath, {
            recursive: true
        });
    }

    async delete(
        uri: vscode.Uri,
        options: {
            readonly recursive: boolean;
        }
    ): Promise<void> {
        const localPath = this.toLocalPath(uri);

        logger.info(`[local] delete ${localPath}`);

        await fs.promises.rm(localPath, {
            recursive: options.recursive
        });
    }

    async rename(
        uri: vscode.Uri,
        newUri: vscode.Uri,
        options: {
            readonly overwrite: boolean;
        }
    ): Promise<void> {
        const oldPath = this.toLocalPath(uri);

        const newPath = this.toLocalPath(newUri);

        logger.info(
            `[local] rename ${oldPath} -> ${newPath}`
        );

        await fs.promises.rename(oldPath, newPath);
    }
}
