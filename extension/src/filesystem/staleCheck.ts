import * as vscode from 'vscode';
import { RPCClient } from '../rpc/client';
import { remotePath } from './connection';
import { logger } from '../logger';

export interface Fingerprint {
    mtime: number;
    size: number;
    hash: string | null;
}

interface Baseline {
    fp: Fingerprint;
    /** Connection epoch at the time the baseline was captured. */
    epoch: number;
}

const SNAPSHOT_SCHEME = 'remotefs-snapshot';

function fingerprintsEqual(a: Fingerprint, b: Fingerprint): boolean {
    if (a.hash && b.hash) {
        return a.hash === b.hash;
    }
    // No hash available (large file): fall back to mtime + size.
    return a.mtime === b.mtime && a.size === b.size;
}

/**
 * Detects when an open remotefs file was overwritten on the server while it sat
 * open. To avoid a round-trip on every tab switch, the check runs **only when
 * the socket has reconnected since the file was last read** — while the socket
 * stays up the file watcher already pushes changes, so the focus check is just
 * the catch-up for events missed across a disconnect.
 */
export class StaleTracker {
    private baselines = new Map<string, Baseline>();
    private snapshots = new Map<string, string>();
    private checking = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly getClient: (uri: vscode.Uri) => RPCClient | undefined,
        private readonly fireChanged: (uri: vscode.Uri) => void
    ) {
        this.disposables.push(
            vscode.workspace.registerTextDocumentContentProvider(SNAPSHOT_SCHEME, {
                provideTextDocumentContent: (uri) =>
                    this.snapshots.get(uri.query) ?? ''
            })
        );
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor && editor.document.uri.scheme === 'remotefs') {
                    void this.checkOnFocus(editor.document);
                }
            })
        );
    }

    /** Called by the provider after every readFile with the served fingerprint. */
    public recordBaseline(uri: vscode.Uri, fp: Fingerprint | undefined): void {
        if (!fp) {
            return;
        }
        const client = this.getClient(uri);
        this.baselines.set(uri.toString(), { fp, epoch: client?.getEpoch() ?? 0 });
    }

    private async checkOnFocus(document: vscode.TextDocument): Promise<void> {
        const uri = document.uri;
        const key = uri.toString();
        if (this.checking.has(key)) {
            return;
        }

        const baseline = this.baselines.get(key);
        const client = this.getClient(uri);
        if (!baseline || !client) {
            return;
        }

        // Reconnect gate: only check if the socket dropped and came back since
        // this file was last read. Otherwise the watcher already has us covered.
        if (client.getEpoch() <= baseline.epoch) {
            return;
        }

        this.checking.add(key);
        try {
            const current: Fingerprint = await client.call('fingerprint', { path: remotePath(uri) });
            if (fingerprintsEqual(baseline.fp, current)) {
                // Unchanged; just refresh the epoch so we stop re-checking.
                this.baselines.set(key, { fp: current, epoch: client.getEpoch() });
                return;
            }
            await this.handleOverride(document, current);
        } catch (err: any) {
            logger.error(`Stale check failed for ${key}: ${err?.message ?? err}`);
        } finally {
            this.checking.delete(key);
        }
    }

    private async handleOverride(document: vscode.TextDocument, current: Fingerprint): Promise<void> {
        const uri = document.uri;
        const key = uri.toString();

        if (!document.isDirty) {
            // No local edits to lose — silently reload from the server.
            logger.info(`Server copy changed (clean buffer); reloading ${key}`);
            this.baselines.set(key, { fp: current, epoch: this.getClient(uri)?.getEpoch() ?? 0 });
            this.fireChanged(uri);
            return;
        }

        // Real conflict: local unsaved edits AND the server copy changed.
        const choice = await vscode.window.showWarningMessage(
            `"${uri.path}" changed on the server since you opened it, and you have unsaved edits.`,
            { modal: false },
            'Reload (discard local)',
            'Keep mine',
            'Compare'
        );

        if (choice === 'Reload (discard local)') {
            this.baselines.set(key, { fp: current, epoch: this.getClient(uri)?.getEpoch() ?? 0 });
            await vscode.commands.executeCommand('workbench.action.files.revertResource', uri)
                .then(undefined, () => this.fireChanged(uri));
        } else if (choice === 'Compare') {
            await this.showDiff(uri);
            // Keep the baseline epoch stale so the user can decide later.
        } else {
            // Keep mine: stop nagging until the next reconnect.
            this.baselines.set(key, { fp: this.baselines.get(key)!.fp, epoch: this.getClient(uri)?.getEpoch() ?? 0 });
        }
    }

    private async showDiff(uri: vscode.Uri): Promise<void> {
        const client = this.getClient(uri);
        if (!client) {
            return;
        }
        try {
            const res = await client.call('readFile', { path: remotePath(uri) });
            const buf = Buffer.from(res.content, 'base64');
            this.snapshots.set(uri.toString(), buf.toString('utf8'));
            const snapshotUri = vscode.Uri.parse(
                `${SNAPSHOT_SCHEME}:${uri.path} (server)`
            ).with({ query: uri.toString() });
            await vscode.commands.executeCommand(
                'vscode.diff',
                uri,
                snapshotUri,
                `${uri.path}: yours ↔ server`
            );
        } catch (err: any) {
            logger.error(`Failed to open diff: ${err?.message ?? err}`);
        }
    }

    public forget(uri: vscode.Uri): void {
        this.baselines.delete(uri.toString());
        this.snapshots.delete(uri.toString());
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.baselines.clear();
        this.snapshots.clear();
    }
}
