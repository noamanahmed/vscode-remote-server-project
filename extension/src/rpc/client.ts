import * as WebSocket from 'ws';

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

    constructor(private url: string) {}

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.on('open', () => resolve());
            this.ws.on('error', (err) => reject(err));
            this.ws.on('message', (data) => this.handleMessage(data));
        });
    }

    private handleMessage(data: WebSocket.Data) {
        const response: RPCResponse = JSON.parse(data.toString());
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
                pending.reject(new Error(response.error));
            } else {
                pending.resolve(response.payload);
            }
        }
    }

    async call(type: string, payload: any): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect();
        }

        const id = this.nextId++;
        const request: RPCRequest = { id, type, payload };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws!.send(JSON.stringify(request));
        });
    }
}
