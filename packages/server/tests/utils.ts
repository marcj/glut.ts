import {Exchange} from "..";
import {ExchangeServer} from "../src/exchange-server";

const closers: Function[] = [];

export function closeCreatedExchange() {
    for (const close of closers) close();
}

export async function createExchange(): Promise<Exchange> {
    const server = new ExchangeServer('auto');
    await server.start();

    closers.push(() => {
        server.close();
    });
    const client = new Exchange(server.path);
    await client.connect();
    return client;
}
