import WebSocket from 'ws';
import { logger } from '../logger';

export interface RPCRequest {
    id: number;
    type: string;
    payload: any;
}

export interface RPCResponse {
    id: number;
    type: string;
    payload?: any;
    error?: string;
}

/**
 * Server-pushed event (fs.changed, git.branchChanged, terminal.data, ...).
 * These arrive unsolicited with id === 0.
 */
export type EventHandler = (event: RPCResponse) => void;

export class RPCClient {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pendingRequests = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private pendingStreams = new Map<number, (res: RPCResponse) => void>();

    private eventHandlers = new Set<EventHandler>();
    private reconnectHandlers = new Set<() => void>();

    /**
     * Increments on every successful (re)connect. Consumers compare a stored
     * epoch against the current one to detect that the socket dropped and came
     * back (used for stale/override detection on focus).
     */
    private connectionEpoch = 0;

    private connectPromise: Promise<void> | null = null;
    private wantConnected = false;
    private disposed = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;

    constructor(private url: string, private token: string = '') {}

    public getEpoch(): number {
        return this.connectionEpoch;
    }

    public isConnected(): boolean {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    public onEvent(handler: EventHandler): { dispose(): void } {
        this.eventHandlers.add(handler);
        return { dispose: () => this.eventHandlers.delete(handler) };
    }

    public onReconnect(handler: () => void): { dispose(): void } {
        this.reconnectHandlers.add(handler);
        return { dispose: () => this.reconnectHandlers.delete(handler) };
    }

    public setUrl(url: string, token: string = '') {
        if (this.url !== url || this.token !== token) {
            logger.info(`URL or token changed. Reconnecting socket.`);
            this.url = url;
            this.token = token;
            this.disconnect();
        }
    }

    private disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            try { ws.close(); } catch { /* ignore */ }
        }
    }

    async connect(): Promise<void> {
        this.wantConnected = true;
        if (this.isConnected()) {
            return;
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        const fullUrl = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
        logger.info(`Connecting to daemon at ${this.url} (token provided: ${!!this.token})...`);

        this.connectPromise = new Promise<void>((resolve, reject) => {
            try {
                const ws = new WebSocket(fullUrl);
                this.ws = ws;

                ws.on('open', () => {
                    logger.info(`Successfully connected to ${this.url}`);
                    this.connectPromise = null;
                    this.reconnectAttempts = 0;
                    this.connectionEpoch++;
                    if (this.connectionEpoch > 1) {
                        // A real reconnect, not the first connect.
                        this.reconnectHandlers.forEach(h => {
                            try { h(); } catch (e) { logger.error(`reconnect handler failed: ${e}`); }
                        });
                    }
                    resolve();
                });

                ws.on('message', (data) => this.handleMessage(data));

                ws.on('error', (err) => {
                    logger.error(`Connection error for ${this.url}: ${err.message}`);
                    this.connectPromise = null;
                    reject(err);
                });

                ws.on('close', () => {
                    logger.info(`Disconnected from ${this.url}`);
                    if (this.ws === ws) {
                        this.ws = null;
                    }
                    this.connectPromise = null;
                    const err = new Error('WebSocket closed');
                    this.pendingRequests.forEach(p => p.reject(err));
                    this.pendingRequests.clear();
                    this.pendingStreams.clear();
                    this.scheduleReconnect();
                });
            } catch (err: any) {
                logger.error(`Failed to create WebSocket: ${err.message}`);
                this.connectPromise = null;
                reject(err);
            }
        });

        return this.connectPromise;
    }

    private scheduleReconnect() {
        if (this.disposed || !this.wantConnected || this.reconnectTimer) {
            return;
        }
        const delay = Math.min(30000, 500 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts++;
        logger.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(err => {
                logger.error(`Reconnect failed: ${err?.message ?? err}`);
                this.scheduleReconnect();
            });
        }, delay);
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const response: RPCResponse = JSON.parse(data.toString());

            // One-shot RPC responses.
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                this.pendingRequests.delete(response.id);
                if (response.error) {
                    logger.error(`RPC Error (ID:${response.id}): ${response.error}`);
                    pending.reject(new Error(response.error));
                } else {
                    pending.resolve(response.payload);
                }
                return;
            }

            // Streaming responses.
            const streamCallback = this.pendingStreams.get(response.id);
            if (streamCallback) {
                if (response.type === 'done' || response.type === 'error') {
                    this.pendingStreams.delete(response.id);
                }
                streamCallback(response);
                return;
            }

            // Unsolicited server-pushed events (id === 0).
            this.eventHandlers.forEach(h => {
                try { h(response); } catch (e) { logger.error(`event handler failed: ${e}`); }
            });
        } catch (err) {
            logger.error(`Failed to handle message: ${err}`);
        }
    }

    async call(type: string, payload: any): Promise<any> {
        if (!this.isConnected()) {
            await this.connect();
        }

        const id = this.nextId++;
        const request: RPCRequest = { id, type, payload };
        logger.info(`RPC Call (ID:${id}): ${type}`);

        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.pendingRequests.set(id, { resolve, reject });
                this.ws.send(JSON.stringify(request));
            } else {
                reject(new Error('WebSocket is not open'));
            }
        });
    }

    /**
     * Fire-and-forget send (terminal input/resize/close). Connects if needed.
     */
    async send(type: string, payload: any): Promise<void> {
        if (!this.isConnected()) {
            await this.connect();
        }
        const id = this.nextId++;
        const request: RPCRequest = { id, type, payload };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(request));
        }
    }

    async *stream(type: string, payload: any): AsyncGenerator<RPCResponse, void, unknown> {
        if (!this.isConnected()) {
            await this.connect();
        }

        const id = this.nextId++;
        const request: RPCRequest = { id, type, payload };
        logger.info(`RPC Stream (ID:${id}): ${type}`);

        const results: RPCResponse[] = [];
        let done = false;
        let error: Error | null = null;
        let resolver: (() => void) | null = null;

        this.pendingStreams.set(id, (res: RPCResponse) => {
            if (res.type === 'error') {
                error = new Error(res.error);
            } else if (res.type === 'done') {
                done = true;
            } else {
                results.push(res);
            }
            if (resolver) {
                resolver();
                resolver = null;
            }
        });

        this.ws!.send(JSON.stringify(request));

        while (!done || results.length > 0) {
            if (results.length > 0) {
                yield results.shift()!;
            } else if (error) {
                throw error;
            } else if (!done) {
                await new Promise<void>(r => resolver = r);
            }
        }
    }

    public dispose(): void {
        logger.info(`Disposing RPC client for ${this.url}`);
        this.disposed = true;
        this.wantConnected = false;
        this.disconnect();

        const err = new Error('RPC client disposed');
        this.pendingRequests.forEach(p => p.reject(err));
        this.pendingRequests.clear();
        this.pendingStreams.clear();
        this.eventHandlers.clear();
        this.reconnectHandlers.clear();
    }
}
