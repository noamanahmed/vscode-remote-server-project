import * as vscode from 'vscode';
import { RPCClient, RPCResponse } from '../rpc/client';
import { logger } from '../logger';

/**
 * A VS Code Pseudoterminal backed by a real PTY on the daemon, so opening a
 * terminal gives the user the actual remote server shell.
 */
export class RemotePty implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    readonly onDidWrite = this.writeEmitter.event;

    private readonly closeEmitter = new vscode.EventEmitter<number | void>();
    readonly onDidClose = this.closeEmitter.event;

    private terminalId: string | null = null;
    private eventSub: { dispose(): void } | null = null;
    private pendingCols = 80;
    private pendingRows = 24;

    constructor(private readonly client: RPCClient) {}

    async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
        if (initialDimensions) {
            this.pendingCols = initialDimensions.columns;
            this.pendingRows = initialDimensions.rows;
        }

        this.eventSub = this.client.onEvent((event) => this.onServerEvent(event));

        try {
            const res = await this.client.call('terminal.create', {
                cols: this.pendingCols,
                rows: this.pendingRows
            });
            this.terminalId = res.terminalId;
            logger.info(`Remote terminal opened: ${this.terminalId}`);
        } catch (err: any) {
            this.writeEmitter.fire(`\r\n\x1b[31mFailed to open remote terminal: ${err?.message ?? err}\x1b[0m\r\n`);
            this.closeEmitter.fire(1);
        }
    }

    private onServerEvent(event: RPCResponse): void {
        if (!this.terminalId || event.payload?.terminalId !== this.terminalId) {
            return;
        }
        if (event.type === 'terminal.data') {
            this.writeEmitter.fire(event.payload.data);
        } else if (event.type === 'terminal.exit') {
            this.closeEmitter.fire(event.payload.code ?? 0);
        }
    }

    handleInput(data: string): void {
        if (this.terminalId) {
            void this.client.send('terminal.input', { terminalId: this.terminalId, data });
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.pendingCols = dimensions.columns;
        this.pendingRows = dimensions.rows;
        if (this.terminalId) {
            void this.client.send('terminal.resize', {
                terminalId: this.terminalId,
                cols: dimensions.columns,
                rows: dimensions.rows
            });
        }
    }

    close(): void {
        if (this.terminalId) {
            void this.client.send('terminal.close', { terminalId: this.terminalId });
        }
        this.eventSub?.dispose();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}

export function openRemoteTerminal(client: RPCClient, name = 'Remote'): vscode.Terminal {
    const pty = new RemotePty(client);
    const terminal = vscode.window.createTerminal({ name, pty });
    terminal.show();
    return terminal;
}

/**
 * Profile id; must match contributes.terminal.profiles[].id in package.json.
 */
export const REMOTE_TERMINAL_PROFILE_ID = 'remotefs.terminalProfile';

/**
 * Registers the remote shell as a terminal profile so it shows up in the
 * terminal dropdown ("+" menu) and can be set as the default profile. This is
 * what makes VS Code's terminal open the *server* shell instead of the local
 * one.
 */
export function registerRemoteTerminalProfile(
    getClient: (uri: vscode.Uri) => RPCClient
): vscode.Disposable {
    return vscode.window.registerTerminalProfileProvider(REMOTE_TERMINAL_PROFILE_ID, {
        async provideTerminalProfile(): Promise<vscode.TerminalProfile> {
            const rootUri = vscode.Uri.from({ scheme: 'remotefs', path: '/' });
            const client = getClient(rootUri);
            await client.connect();
            return new vscode.TerminalProfile({
                name: 'Remote Shell',
                pty: new RemotePty(client)
            });
        }
    });
}
