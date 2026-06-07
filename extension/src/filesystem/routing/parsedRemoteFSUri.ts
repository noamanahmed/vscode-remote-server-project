export interface ParsedRemoteFSUri {
    localPath: string;

    remotePath?: string;

    host: string;

    port: number;

    token?: string;
}