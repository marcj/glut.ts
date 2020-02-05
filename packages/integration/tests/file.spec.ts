import 'jest';
import 'reflect-metadata';
import {Action, Controller, GlutFile, StreamBehaviorSubject} from "@marcj/glut-core";
import {EntityStorage, FS} from "@marcj/glut-server";
import {closeAllCreatedServers, createServerClientPair} from "./util";
import {sleep} from '@marcj/estdlib';
import {Buffer} from 'buffer';
import {arrayBufferTo} from "@marcj/marshal";

// @ts-ignore
global['WebSocket'] = require('ws');

afterAll(async () => {
    await closeAllCreatedServers();
});

test('test file list', async () => {
    @Controller('test')
    class TestController {
        constructor(
            private storage: EntityStorage,
            private fs: FS<GlutFile>,
        ) {

        }

        @Action()
        async init() {
            await this.fs.removeAll({});

            await this.fs.write('test1.txt', 'Was geht?');
            await this.fs.write('test2.txt', 'Nix');
            await this.fs.write('test2-doppelt.txt', 'Nix');
        }

        @Action()
        async deleteTest2() {
            await this.fs.removeAll({
                path: 'test2.txt'
            });
        }

        @Action()
        async content(path: string) {
            return await this.fs.subscribe(path, {});
        }

        @Action()
        async write(path: string, content: string) {
            await this.fs.write(path, content);
        }

        @Action()
        async files() {
            return this.storage.collection(GlutFile).filter({
                path: {$regex: /^test2/}
            }).find();
        }
    }

    const {client, close} = await createServerClientPair('test file list', [TestController], []);
    const test = client.controller<TestController>('test');
    await test.init();

    const files = await test.files();

    expect(files.count()).toBe(2);

    test.deleteTest2();
    await files.nextStateChange;
    expect(files.count()).toBe(1);

    const fileContent = await test.content('test1.txt');
    expect(fileContent).toBeInstanceOf(StreamBehaviorSubject);
    expect(arrayBufferTo(fileContent.value!, 'utf8')).toBe('Was geht?');

    test.write('test1.txt', 'updated');
    await fileContent.nextStateChange;
    expect(arrayBufferTo(fileContent.value!, 'utf8')).toBe('updated');

    await close();
});

test('test file stream', async () => {
    @Controller('test')
    class TestController {
        constructor(
            private storage: EntityStorage,
            private fs: FS<GlutFile>,
        ) {

        }

        @Action()
        async init() {
            await this.fs.removeAll({});
        }

        @Action()
        async stream(path: string, content: string) {
            await this.fs.stream(path, Buffer.from(content, 'utf8'));
        }

        @Action()
        async content(path: string) {
            return await this.fs.subscribe(path, {});
        }
    }

    const {client, close} = await createServerClientPair('test file stream', [TestController], []);
    const test = client.controller<TestController>('test');
    await test.init();

    await test.stream('stream.txt', 'init');

    const fileContent = await test.content('stream.txt');
    fileContent.activateNextOnAppend();

    expect(fileContent).toBeInstanceOf(StreamBehaviorSubject);
    expect(Buffer.from(fileContent.value!).toString('utf8')).toBe('init');

    test.stream('stream.txt', '\nupdated');
    await fileContent.nextStateChange;
    expect(Buffer.from(fileContent.value!).toString('utf8')).toBe('init\nupdated');

    await fileContent.unsubscribe();
    await test.stream('stream.txt', '\nnext');

    await sleep(0.2);
    //content is still the same, since we unsubscribed
    expect(Buffer.from(fileContent.value!).toString('utf8')).toBe('init\nupdated');

    const binaryContent = await test.content('stream.txt');
    expect(binaryContent.value).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(binaryContent.value!).toString('utf8')).toBe('init\nupdated\nnext');
    binaryContent.unsubscribe();

    const fileContentUtf = (await test.content('stream.txt')).toUTF8();
    fileContentUtf.activateNextOnAppend();
    expect(fileContentUtf.value).toBe('init\nupdated\nnext');

    console.log('end stream');
    test.stream('stream.txt', '\nend');
    await fileContentUtf.nextStateChange;
    expect(fileContentUtf.value).toBe('init\nupdated\nnext\nend');

    await close();
});
