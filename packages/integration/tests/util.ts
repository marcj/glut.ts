import 'jest';
import {arrayRemoveItem, ClassType, sleep} from "@marcj/estdlib";
import {Application, ApplicationServer, Session} from "@marcj/glut-server";
import {SocketClient} from "@marcj/glut-client";
import {RemoteController} from "@marcj/glut-core";
import {Observable} from "rxjs";
import {Injector} from 'injection-js';
import {Database} from '@marcj/marshal-mongo';
import {createServer} from "http";

export async function subscribeAndWait<T>(observable: Observable<T>, callback: (next: T) => Promise<void>, timeout: number = 5): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const sub = observable.subscribe((next) => {
            callback(next);
            sub.unsubscribe();
            resolve();
        }, (error) => {
            reject(error);
        });
        setTimeout(() => {
            sub.unsubscribe();
            reject('Subscribe timeout');
        }, timeout * 1000);
    });
}

const closer: (() => Promise<void>)[] = [];

// doesn't work yet automatically
// afterEach(async () => {
//     for (const close of closer) {
//         await close();
//     }
// });

class MyApp extends Application {
    public lastConnectionInjector?: Injector;

    async hasAccess<T>(injector: Injector, session: Session | undefined, controller: ClassType<T>, action: string): Promise<boolean> {
        this.lastConnectionInjector = injector;
        return super.hasAccess(injector, session, controller, action);
    }
}

const startPort = 2800;
const portFile = '/tmp/glut-integration-port.txt';

export async function closeAllCreatedServers() {
    for (const close of closer) {
        await close();
    }
}

export async function createServerClientPair(
    dbTestName: string,
    controllers: ClassType<any>[],
    entityChangeFeeds: ClassType<any>[] = [],
    appController: ClassType<any> = MyApp
): Promise<{
    server: ApplicationServer,
    client: SocketClient,
    close: () => Promise<void>,
    createClient: () => SocketClient,
    createControllerClient: <T>(controllerName: string) => RemoteController<T>,
    app: MyApp
}> {
    const dbName = 'glut_tests_' + dbTestName.replace(/[^a-zA-Z0-9]+/g, '_');

    const socketPath = '/tmp/ws_socket_' + new Date().getTime() + '.' + Math.floor(Math.random() * 1000);
    const exchangeSocketPath = socketPath + '_exchange';

    const server = createServer();
    await new Promise((resolve) => {
        server.listen(socketPath, function () {
            resolve();
        });
    });

    const app = new ApplicationServer(appController, {
        server: server,
        mongoDbName: dbName,
        exchangeUnixPath: exchangeSocketPath
    }, [], [], controllers, [], entityChangeFeeds);

    await app.start();

    const db: Database = app.getInjector().get(Database);
    await (await db.connection.connect()).db(dbName).dropDatabase();

    const createdClients: SocketClient[] = [];

    const socket = new SocketClient({
        host: 'ws+unix://' + socketPath
    });

    createdClients.push(socket);

    let closed = false;

    const close = async () => {
        arrayRemoveItem(closer, close);

        if (closed) {
            return;
        }

        console.log('server close ...');
        // await db.dropDatabase(dbName);
        closed = true;

        for (const client of createdClients) {
            try {
                client.disconnect();
            } catch (error) {
                console.error('failed disconnecting client');
                throw error;
            }
        }

        await sleep(0.1); //let the server read the disconnect
        const start = performance.now();
        await app.close();
        console.log('server closed', performance.now() - start);
    };

    closer.push(close);
    return {
        server: app,
        client: socket,
        createClient: () => {
            const client = new SocketClient({
                host: 'ws+unix://' + socketPath
            });
            createdClients.push(client);
            return client;
        },
        createControllerClient: <T>(controllerName: string): RemoteController<T> => {
            const client = new SocketClient({
                host: 'ws+unix://' + socketPath
            });
            createdClients.push(client);
            return client.controller<T>(controllerName);
        },
        close: close,
        app: app.getApplication()
    };
}
