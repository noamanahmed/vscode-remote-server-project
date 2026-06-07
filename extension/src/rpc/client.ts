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

export class RPCClient {
    private ws: WebSocket | null = null;
    private nextId = 1;
    private pendingRequests = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private pendingStreams = new Map<number, (res: RPCResponse) => void>();

    constructor(private url: string, private token: string = '') {}

    public setUrl(url: string, token: string = '') {
        if (this.url !== url || this.token !== token) {
            logger.info(`URL or token changed. Disconnecting existing socket.`);
            this.url = url;
            this.token = token;
            this.disconnect();
        }
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async connect(): Promise<void> {
        const fullUrl = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
        logger.info(`Connecting to daemon at ${this.url} (token provided: ${!!this.token})...`);
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(fullUrl);
                
                this.ws.on('open', () => {
                    logger.info(`Successfully connected to ${this.url}`);
                    resolve();
                });
                
                this.ws.on('error', (err) => {
                    logger.error(`Connection error for ${this.url}: ${err.message}`);
                    reject(err);
                });
                
                this.ws.on('message', (data) => this.handleMessage(data));
                
                this.ws.on('close', () => {
                    logger.info(`Disconnected from ${this.url}`);
                    // Reject all pending requests
                    const err = new Error('WebSocket closed');
                    this.pendingRequests.forEach(p => p.reject(err));
                    this.pendingRequests.clear();
                    this.pendingStreams.clear();
                });
            } catch (err: any) {
                logger.error(`Failed to create WebSocket: ${err.message}`);
                reject(err);
            }
        });
    }

    private handleMessage(data: WebSocket.Data) {
        try {
            const response: RPCResponse = JSON.parse(data.toString());
            
            // Check pending calls
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

            // Check pending streams
            const streamCallback = this.pendingStreams.get(response.id);
            if (streamCallback) {
                if (response.type === 'done' || response.type === 'error') {
                    this.pendingStreams.delete(response.id);
                }
                streamCallback(response);
            }
        } catch (err) {
            logger.error(`Failed to handle message: ${err}`);
        }
    }

    async call(type: string, payload: any): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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

    async *stream(type: string, payload: any): AsyncGenerator<RPCResponse, void, unknown> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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

        this.disconnect();

        const err = new Error('RPC client disposed');

        this.pendingRequests.forEach(p => p.reject(err));

        this.pendingRequests.clear();

        this.pendingStreams.clear();
    }
}
