import * as vscode from 'vscode';
import * as path from 'path';
import { RPCClient } from '../rpc/client';
import { remotePath } from '../filesystem/connection';
import { logger } from '../logger';

const ORIGINAL_SCHEME = 'remotefs-git';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface StatusEntry {
    path: string;
    origPath: string | null;
    index: string;        // staged status char
    workingTree: string;  // working-tree status char
}

interface DecoData {
    badge: string;
    color: string;
    tooltip: string;
    strikeThrough: boolean;
}

function statusLabel(code: string): string {
    switch (code) {
        case 'M': return 'Modified';
        case 'A': return 'Added';
        case 'D': return 'Deleted';
        case 'R': return 'Renamed';
        case 'C': return 'Copied';
        case 'U': return 'Conflicted';
        case '?': return 'Untracked';
        default: return 'Changed';
    }
}

function decoFor(code: string): DecoData {
    const map: Record<string, [string, string]> = {
        M: ['M', 'gitDecoration.modifiedResourceForeground'],
        A: ['A', 'gitDecoration.addedResourceForeground'],
        D: ['D', 'gitDecoration.deletedResourceForeground'],
        R: ['R', 'gitDecoration.renamedResourceForeground'],
        C: ['C', 'gitDecoration.renamedResourceForeground'],
        U: ['U', 'gitDecoration.conflictingResourceForeground'],
        '?': ['U', 'gitDecoration.untrackedResourceForeground']
    };
    const [badge, color] = map[code] ?? ['•', 'gitDecoration.modifiedResourceForeground'];
    return { badge, color, tooltip: statusLabel(code), strikeThrough: code === 'D' };
}

/** Badges in the explorer + SCM view for changed remote files. */
class GitDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    constructor(private readonly lookup: () => Map<string, DecoData>) {}

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== 'remotefs') {
            return undefined;
        }
        const d = this.lookup().get(uri.toString());
        if (!d) {
            return undefined;
        }
        return {
            badge: d.badge,
            color: new vscode.ThemeColor(d.color),
            tooltip: d.tooltip,
            propagate: true
        };
    }

    refresh(uris: vscode.Uri[]): void {
        this._onDidChange.fire(uris);
    }
}

/**
 * A Source Control provider backed by `git` running on the daemon. The built-in
 * VS Code Git extension cannot operate on the remotefs virtual filesystem, so we
 * surface the server-side repository here.
 */
export class RemoteGitProvider implements vscode.Disposable {
    private scm: vscode.SourceControl | undefined;
    private stagedGroup: vscode.SourceControlResourceGroup | undefined;
    private changesGroup: vscode.SourceControlResourceGroup | undefined;

    private readonly decorationProvider: GitDecorationProvider;
    private decorations = new Map<string, DecoData>();
    private snapshots = new Map<string, string>(); // original path key -> HEAD content

    private readonly disposables: vscode.Disposable[] = [];
    private eventSub: { dispose(): void } | null = null;
    private refreshTimer: NodeJS.Timeout | null = null;
    private activating = false;

    constructor(
        private readonly rootUri: vscode.Uri,
        private readonly getClient: (uri: vscode.Uri) => RPCClient
    ) {
        this.decorationProvider = new GitDecorationProvider(() => this.decorations);
        this.disposables.push(
            vscode.window.registerFileDecorationProvider(this.decorationProvider),
            vscode.workspace.registerTextDocumentContentProvider(ORIGINAL_SCHEME, {
                provideTextDocumentContent: (uri) => this.provideOriginalContent(uri)
            })
        );
        this.registerCommands();
    }

    /**
     * Connect, confirm the served folder is a git repo, register the Source
     * Control provider, and load status. Retries on transient connection
     * errors and logs every step to the RemoteFS output channel so failures
     * are diagnosable rather than silent.
     */
    public async activate(): Promise<void> {
        const client = this.getClient(this.rootUri);

        // Subscribe to change events (and re-activate on reconnect) exactly once.
        if (!this.eventSub) {
            this.eventSub = client.onEvent((e) => {
                if (e.type === 'fs.changed' || e.type === 'git.branchChanged') {
                    this.scheduleRefresh();
                }
            });
            client.onReconnect(() => { void this.activate(); });
        }

        if (this.activating) {
            return;
        }
        this.activating = true;
        try {
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    await client.connect();
                    const repo = await client.call('git.isRepo', {});
                    if (!repo?.isRepo) {
                        logger.info('RemoteFS Git: served folder is not a git repository — Source Control hidden. (Check the daemon log; ensure git is installed and --folder is the repo.)');
                        return;
                    }
                    // Create the provider up-front so it appears even before the
                    // first status resolves.
                    this.ensureScm();
                    logger.info('RemoteFS Git: Source Control provider registered.');
                    await this.refresh();
                    return;
                } catch (err: any) {
                    logger.error(`RemoteFS Git: activation attempt ${attempt}/5 failed: ${err?.message ?? err}`);
                    await delay(800 * attempt);
                }
            }
            logger.error('RemoteFS Git: could not activate Source Control after retries. Run "RemoteFS Git: Refresh" to retry.');
        } finally {
            this.activating = false;
        }
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh();
        }, 300);
    }

    private ensureScm(): void {
        if (this.scm) {
            return;
        }
        this.scm = vscode.scm.createSourceControl('remotefs', 'RemoteFS', this.rootUri);
        this.scm.acceptInputCommand = { command: 'remotefs.git.commit', title: 'Commit' };
        this.scm.inputBox.placeholder = 'Message (Ctrl+Enter to commit on the server)';
        this.scm.quickDiffProvider = {
            provideOriginalResource: (uri) => this.originalResource(uri)
        };
        this.stagedGroup = this.scm.createResourceGroup('staged', 'Staged Changes');
        this.changesGroup = this.scm.createResourceGroup('changes', 'Changes');
        this.stagedGroup.hideWhenEmpty = true;
        this.changesGroup.hideWhenEmpty = true;
        this.disposables.push(this.scm, this.stagedGroup, this.changesGroup);
    }

    public async refresh(): Promise<void> {
        const client = this.getClient(this.rootUri);
        let res: { branch: string | null; entries: StatusEntry[] };
        try {
            res = await client.call('git.status', {});
        } catch (err: any) {
            logger.error(`RemoteFS Git: git.status failed: ${err?.message ?? err}`);
            return;
        }

        this.ensureScm();
        const staged: vscode.SourceControlResourceState[] = [];
        const changes: vscode.SourceControlResourceState[] = [];
        const deco = new Map<string, DecoData>();
        const changed: vscode.Uri[] = [];

        for (const entry of res.entries) {
            const uri = this.uriFor(entry.path);
            changed.push(uri);

            const inIndex = entry.index !== ' ' && entry.index !== '?';
            const inWorking = entry.workingTree !== ' ';

            if (inIndex) {
                staged.push(this.toState(uri, entry.index, true));
            }
            if (inWorking) {
                changes.push(this.toState(uri, entry.workingTree, false));
            }

            // Decorate using the working-tree status, falling back to index.
            deco.set(uri.toString(), decoFor(inWorking ? entry.workingTree : entry.index));
        }

        this.stagedGroup!.resourceStates = staged;
        this.changesGroup!.resourceStates = changes;
        this.scm!.count = staged.length + changes.length;
        if (this.scm) {
            this.scm.inputBox.enabled = true;
        }

        // Update decorations (fire for both old and new keys).
        const previous = [...this.decorations.keys()].map((k) => vscode.Uri.parse(k));
        this.decorations = deco;
        this.decorationProvider.refresh([...previous, ...changed]);
    }

    private toState(uri: vscode.Uri, code: string, staged: boolean): vscode.SourceControlResourceState {
        const deleted = code === 'D';
        const label = `${path.basename(uri.path)} (${staged ? 'Index' : 'Working Tree'})`;
        return {
            resourceUri: uri,
            decorations: {
                strikeThrough: deleted,
                tooltip: statusLabel(code)
            },
            command: deleted ? undefined : {
                command: 'vscode.diff',
                title: 'Open Changes',
                arguments: [this.originalResource(uri), uri, label]
            }
        };
    }

    private uriFor(relPath: string): vscode.Uri {
        return this.rootUri.with({ path: relPath });
    }

    private originalResource(uri: vscode.Uri): vscode.Uri {
        // Encode the target path in the query so the content provider can fetch
        // the HEAD version from the daemon.
        return vscode.Uri.from({
            scheme: ORIGINAL_SCHEME,
            path: uri.path,
            query: uri.path
        });
    }

    private async provideOriginalContent(uri: vscode.Uri): Promise<string> {
        const target = uri.query || uri.path;
        try {
            const client = this.getClient(this.rootUri);
            const res = await client.call('git.show', { path: target });
            if (!res || res.content === null || res.content === undefined) {
                return '';
            }
            return Buffer.from(res.content, 'base64').toString('utf8');
        } catch (err: any) {
            logger.error(`git.show failed for ${target}: ${err?.message ?? err}`);
            return '';
        }
    }

    // --- commands --------------------------------------------------------
    private registerCommands(): void {
        const reg = (id: string, fn: (...args: any[]) => any) =>
            this.disposables.push(vscode.commands.registerCommand(id, fn));

        reg('remotefs.git.refresh', () => this.activate());
        reg('remotefs.git.commit', () => this.commit());
        reg('remotefs.git.stage', (...args) => this.runOnPaths('git.stage', args));
        reg('remotefs.git.unstage', (...args) => this.runOnPaths('git.unstage', args));
        reg('remotefs.git.discard', (...args) => this.discard(args));
    }

    private collectPaths(args: any[]): string[] {
        const uris: vscode.Uri[] = [];
        const push = (a: any) => {
            if (!a) {
                return;
            }
            if (a.resourceUri) {
                uris.push(a.resourceUri);
            } else if (a.resourceStates) {
                // A resource group.
                for (const s of a.resourceStates) {
                    uris.push(s.resourceUri);
                }
            } else if (a instanceof vscode.Uri) {
                uris.push(a);
            }
        };
        args.flat().forEach(push);
        return uris.map((u) => remotePath(u));
    }

    private async runOnPaths(rpc: string, args: any[]): Promise<void> {
        const paths = this.collectPaths(args);
        if (!paths.length) {
            return;
        }
        try {
            await this.getClient(this.rootUri).call(rpc, { paths });
            await this.refresh();
        } catch (err: any) {
            vscode.window.showErrorMessage(`RemoteFS Git: ${err?.message ?? err}`);
        }
    }

    private async discard(args: any[]): Promise<void> {
        const paths = this.collectPaths(args);
        if (!paths.length) {
            return;
        }
        const ok = await vscode.window.showWarningMessage(
            `Discard changes in ${paths.length} file(s)? This cannot be undone.`,
            { modal: true },
            'Discard'
        );
        if (ok !== 'Discard') {
            return;
        }
        await this.runOnPaths('git.discard', args);
    }

    private async commit(): Promise<void> {
        if (!this.scm) {
            return;
        }
        const message = this.scm.inputBox.value.trim();
        if (!message) {
            vscode.window.showWarningMessage('RemoteFS Git: enter a commit message first.');
            return;
        }
        try {
            await this.getClient(this.rootUri).call('git.commit', { message });
            this.scm.inputBox.value = '';
            await this.refresh();
            vscode.window.showInformationMessage('RemoteFS Git: committed on the server.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`RemoteFS Git: commit failed: ${err?.message ?? err}`);
        }
    }

    public dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.eventSub?.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
}
