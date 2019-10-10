import {Subscription} from "rxjs";
import {getEntityName} from "@marcj/marshal";
import {ExchangeEntity, StreamFileResult} from '@marcj/glut-core';
import {ClassType, sleep} from '@marcj/estdlib';
import {Injectable} from "injection-js";
import {decodeMessage, encodeMessage, uintToString} from './exchange-prot';
import { AsyncSubscription } from "@marcj/estdlib-rxjs";

type Callback<T> = (message: T) => void;

export class ExchangeLock {
    constructor(protected unlocker: () => void) {
    }

    unlock() {
        this.unlocker();
    }
}

@Injectable()
export class Exchange {
    private subscriptions: { [channelName: string]: Callback<any>[] } = {};
    public socket?: WebSocket;
    private connectionPromise?: Promise<void>;

    protected messageId = 1;
    protected replyResolver: { [id: number]: Function } = {};

    constructor(
        protected port: number = 8561,
        protected host: string = '127.0.0.1',
    ) {
    }

    public async disconnect() {
        if (this.socket) {
            this.socket.close();
        }
    }

    public async connect(): Promise<WebSocket> {
        while (this.connectionPromise) {
            await sleep(0.01);
            await this.connectionPromise;
        }

        if (this.socket) {
            return this.socket;
        }

        this.connectionPromise = this.doConnect();

        try {
            await this.connectionPromise;
        } finally {
            delete this.connectionPromise;
        }

        if (!this.socket) {
            throw new Error('Exchange not connected.');
        }

        return this.socket;
    }

    protected async doConnect(): Promise<void> {
        this.socket = undefined;

        return new Promise<void>((resolve, reject) => {
            this.socket = new WebSocket('ws://' + this.host + ':' + this.port);

            this.socket.onerror = () => {
                this.socket = undefined;
                reject(new Error('Error websocket'));
            };

            this.socket.onclose = () => {
                this.socket = undefined;
            };

            this.socket.onmessage = (event: MessageEvent) => {
                this.onMessage(event.data);
            };

            this.socket.onopen = async () => {
                resolve();
            };
        });
    }

    protected onMessage(message: ArrayBuffer) {
        const m = decodeMessage(message);
        // console.log('client message', m);

        if (this.replyResolver[m.id]) {
            this.replyResolver[m.id]({arg: m.arg, payload: m.payload});
            delete this.replyResolver[m.id];
        }

        if (m.type === 'publish') {
            if (this.subscriptions[m.arg]) {
                const data = JSON.parse(uintToString(m.payload));
                for (const cb of this.subscriptions[m.arg].slice(0)) {
                    cb(data);
                }
            }
        }
    }

    public async get(key: string): Promise<any> {
        const reply = await this.sendAndWaitForReply('get', key);
        return reply.payload;
    }

    public async set(key: string, payload: any): Promise<any> {
        await this.send('set', key, payload);
    }

    public async getSubscribedEntityFields<T>(classType: ClassType<T>): Promise<string[]> {
        const a = await this.sendAndWaitForReply('get-entity-subscribe-fields', getEntityName(classType));
        return a.arg;
    }

    public async del(key: string) {
        await this.send('del', key);
    }

    // /**
    //  * This tells the ExchangeDatabase which field values you additionally need in a patch-message.
    //  */
    public async subscribeEntityFields<T>(classType: ClassType<T>, fields: string[]): Promise<AsyncSubscription> {
        this.send('entity-subscribe-fields', getEntityName(classType), fields);

        return new AsyncSubscription(async () => {
            this.send('del-entity-subscribe-fields', getEntityName(classType), fields);
        });
    }

    public async publishEntity<T>(classType: ClassType<T>, message: ExchangeEntity) {
        const channelName = 'entity/' + getEntityName(classType);
        await this.publish(channelName, message);
    }

    public async publishFile<T>(fileId: string, message: StreamFileResult) {
        const channelName = 'file/' + fileId;
        await this.publish(channelName, message);
    }

    public async subscribeEntity<T>(classType: ClassType<T>, cb: Callback<ExchangeEntity>): Promise<Subscription> {
        const channelName = 'entity/' + getEntityName(classType);
        return this.subscribe(channelName, cb);
    }

    public async subscribeFile<T>(fileId: string, cb: Callback<StreamFileResult>): Promise<Subscription> {
        const channelName = 'file/' + fileId;
        return this.subscribe(channelName, cb);
    }

    protected async send(type: string, arg: string, payload?: string | ArrayBuffer | Uint8Array | object): Promise<void> {
        const messageId = this.messageId++;
        const message = encodeMessage(messageId, type, arg, payload);
        (await this.connect()).send(message);
    }

    protected async sendAndWaitForReply(type: string, arg: string, payload?: string | ArrayBuffer | Uint8Array | object): Promise<{arg: any, payload: any}> {
        const messageId = this.messageId++;

        return new Promise(async (resolve) => {
            this.replyResolver[messageId] = resolve;
            (await this.connect()).send(encodeMessage(messageId, type, arg, payload));
        });
    }

    public async publish(channelName: string, message: any) {
        this.send('publish', channelName, message);
    }

    public async lock(name: string, timeout = 0): Promise<ExchangeLock> {
        await this.sendAndWaitForReply('lock', name + '$$' + timeout);
        return new ExchangeLock(() => {
            this.send('unlock', name);
        });
    }

    public async isLocked(name: string): Promise<boolean> {
        return (await this.sendAndWaitForReply('isLocked', name)).arg;
    }

    public async subscribe(channelName: string, callback: Callback<any>): Promise<Subscription> {
        if (!this.subscriptions[channelName]) {
            this.subscriptions[channelName] = [];
            this.subscriptions[channelName].push(callback);
            this.send('subscribe', channelName);
        } else {
            this.subscriptions[channelName].push(callback);
        }

        return new Subscription(() => {
            const index = this.subscriptions[channelName].indexOf(callback);

            if (-1 !== index) {
                this.subscriptions[channelName].splice(index, 1);
            }

            if (this.subscriptions[channelName].length === 0) {
                delete this.subscriptions[channelName];
                this.send('unsubscribe', channelName);
            }
        });
    }
}
