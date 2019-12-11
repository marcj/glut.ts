import {dirname, join} from "path";
import {appendFile, ensureDir, pathExists, readFile, remove, stat, unlink, writeFile} from "fs-extra";
import {Exchange} from "./exchange";
import {ExchangeDatabase} from "./exchange-database";
import {FileMode, FileType, FilterQuery, GlutFile, StreamBehaviorSubject} from "@marcj/glut-core";
import {eachKey, eachPair} from "@marcj/estdlib";
import * as crypto from "crypto";
import {Inject, Injectable} from "injection-js";
import {ProcessLocker} from "./process-locker";

export type PartialFile = { id: string, path: string, mode: FileMode, md5?: string, version: number };

export function getMd5(content: string | Buffer): string {
    const buffer: Buffer = 'string' === typeof content ? new Buffer(content, 'utf8') : new Buffer(content);
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');

    if (!md5) {
        throw new Error(`md5 is empty`);
    }

    return md5;
}

@Injectable()
export class FS<T extends GlutFile> {
    constructor(
        public readonly fileType: FileType<T>,
        private exchange: Exchange,
        private exchangeDatabase: ExchangeDatabase,
        private locker: ProcessLocker,
        @Inject('fs.path') private fileDir: string /* .glut/data/files/ */,
    ) {
    }

    public setFileDir(dir: string) {
        this.fileDir = dir;
    }

    public async removeAll(filter: FilterQuery<T>): Promise<boolean> {
        const files = await this.exchangeDatabase.find(this.fileType.classType, filter);
        return this.removeFiles(files);
    }

    public async remove(path: string, filter: FilterQuery<T> = {}): Promise<boolean> {
        const file = await this.findOne(path, filter);
        if (file) {
            return this.removeFile(file);
        }

        return false;
    }

    public async removeFile(file: T): Promise<boolean> {
        return this.removeFiles([file]);
    }

    public async removeFiles(files: T[]): Promise<boolean> {
        const md5ToCheckMap: { [k: string]: number } = {};
        const fileIds: string[] = [];

        for (const file of files) {
            if (file.md5) {
                //we need to check whether the file is used by others
                md5ToCheckMap[file.md5] = 0;
            } else {
                const split = this.getIdSplit(file.id);
                const localPath = join(this.fileDir, 'streaming', split);
                await remove(localPath);
            }

            fileIds.push(file.id);

            this.exchange.publishFile(file.id, {
                type: 'remove',
                path: file.path
            });
        }

        await this.exchangeDatabase.deleteMany(this.fileType.classType, {
            $and: [{
                id: {$in: fileIds}
            }]
        } as unknown as FilterQuery<T>);

        //found which md5s are still linked
        const fileCollection = await this.exchangeDatabase.collection(this.fileType.classType);

        const foundMd5s = await fileCollection.find({
            md5: {$in: Object.keys(md5ToCheckMap)}
        }, {
            projection: {md5: 1}
        }).toArray();

        //iterate over still linked md5 files, and remove missing ones
        for (const row of foundMd5s) {
            if (row.md5) {
                md5ToCheckMap[row.md5]++;
            }
        }

        const deletes: Promise<any>[] = [];
        for (const [k, v] of eachPair(md5ToCheckMap)) {
            if (v === 0) {
                //no link for that md5 left, so delete file locally
                const localPath = this.getLocalPathForMd5(k);
                deletes.push(remove(localPath));
            }
        }

        //delete them parallel
        await Promise.all(deletes);

        return true;
    }

    public async ls(filter: FilterQuery<T>): Promise<T[]> {
        return await this.exchangeDatabase.find(this.fileType.classType, filter);
    }

    public async findOne(path: string, filter: FilterQuery<T> = {}): Promise<T | undefined> {
        return await this.exchangeDatabase.get(this.fileType.classType, {path: path, ...filter} as T);
    }

    public async registerFile(md5: string, path: string, fields: Partial<T> = {}): Promise<T> {
        const file = await this.exchangeDatabase.get(this.fileType.classType, {md5: md5} as T);

        if (!file) {
            throw new Error(`No file with '${md5}' found.`);
        }

        if (!file.md5) {
            throw new Error(`File ${file.id} has no md5 '${md5}'.`);
        }

        const localPath = this.getLocalPathForMd5(file.md5!);

        if (await pathExists(localPath)) {
            const newFile = this.fileType.fork(file, path);
            for (const i of eachKey(fields)) {
                (newFile as any)[i] = (fields as any)[i];
            }
            await this.exchangeDatabase.add(this.fileType.classType, newFile);
            return newFile;
        } else {
            throw new Error(`File with md5 '${md5}' not found (content deleted).`);
        }
    }

    public async hasMd5InDb(md5: string): Promise<boolean> {
        const collection = await this.exchangeDatabase.collection(this.fileType.classType);
        return 0 < await collection.countDocuments({md5: md5});
    }

    public async hasMd5(md5: string) {
        const file = await this.exchangeDatabase.get(this.fileType.classType, {md5: md5} as T);

        if (file && file.md5) {
            const localPath = this.getLocalPathForMd5(md5);
            return await pathExists(localPath);
        }

        return false;
    }

    public async read(path: string, filter?: FilterQuery<T>): Promise<Buffer | undefined> {
        const file = await this.findOne(path, filter || {});
        // console.log('Read file ' + path, filter, file ? file.id : undefined);

        if (!file) {
            return;
        }

        return new Promise<Buffer>(async (resolve, reject) => {
            const localPath = this.getLocalPath(file);
            if (await pathExists(localPath)) {
                readFile(localPath, (err, data: Buffer) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(data);
                });
            } else {
                resolve();
            }
        });
    }

    public getMd5Split(md5: string) {
        return md5.substr(0, 2) + '/' + md5.substr(2, 2) + '/' + md5.substr(4);
    }

    public getIdSplit(id: string) {
        return id.substr(0, 8) + '/' + id.substr(9, 9) + '/' + id.substr(19);
    }

    public getLocalPathForMd5(md5: string): string {
        if (!md5) {
            console.error('md5', md5);
            throw new Error('No md5 given.');
        }

        return join(this.fileDir, 'closed', this.getMd5Split(md5));
    }

    public getLocalPathForId(id: string): string {
        return join(this.fileDir, 'streaming', this.getIdSplit(id));
    }

    public getLocalPath(file: PartialFile) {
        if (file.mode === FileMode.closed) {
            if (!file.md5) {
                throw new Error(`Closed file has no md5 value: ${file.id} ${file.path}`);
            }
            return this.getLocalPathForMd5(file.md5);
        }

        if (!file.id) {
            throw new Error(`File has no id ${file.path}`);
        }

        return this.getLocalPathForId(file.id);
    }

    /**
     * Adds a new file or updates an existing one.
     */
    public async write(path: string, data: string | Buffer, fields: Partial<T> = {}): Promise<PartialFile> {
        // tslint:disable-next-line:prefer-const
        let {id, md5, version} = await this.exchangeDatabase.increase(this.fileType.classType, {path, ...fields}, {version: 1}, ['id', 'md5']);

        if ('string' === typeof data) {
            data = Buffer.from(data, 'utf8');
        }

        const newMd5 = getMd5(data);

        if (!id) {
            const file = new this.fileType.classType(path);
            file.md5 = getMd5(data);
            for (const i of eachKey(fields)) {
                (file as any)[i] = (fields as any)[i];
            }
            file.size = data.byteLength;
            id = file.id;
            version = 0;
            await this.exchangeDatabase.add(this.fileType.classType, file);
        } else {
            //when md5 changes, it's important to move
            //the local file as well, since local path is based on md5.
            //when there is still an file with that md5 in the database, do not remove the old one.
            if (md5 && md5 !== newMd5) {
                // file.md5 = md5;
                // file.size = data.byteLength;

                //todo, there might be a race condition between .increase and .patch in high-load scenarios.
                // How to solve that?
                // and changed updated field
                await this.exchangeDatabase.patch(this.fileType.classType, id, {md5: newMd5, size: data.byteLength} as T);

                //we need to check whether the local file needs to be removed
                if (!await this.hasMd5InDb(md5)) {
                    //there's no db-file anymore linking using this local file, so remove it
                    const localPath = this.getLocalPathForMd5(md5);
                    if (await pathExists(localPath)) {
                        await unlink(localPath);
                    }
                }
            }
        }

        const localPath = this.getLocalPathForMd5(newMd5);
        const localDir = dirname(localPath);
        await ensureDir(localDir);

        const lock = await this.locker.acquireLock('file:' + path);
        try {
            await writeFile(localPath, data);

            this.exchange.publishFile(id, {
                type: 'set',
                version: version,
                path: path,
            });
        } finally {
            await lock.unlock();
        }

        return {
            id: id,
            mode: FileMode.closed,
            path: path,
            version: version,
            md5: newMd5
        };
    }

    /**
     * Streams content by always appending data to the file's content.
     */
    public async stream(
        path: string,
        data: Buffer,
        fields: Partial<T> = {},
        options: {
            cropSizeAt?: number
            cropSizeAtTo?: number
        } = {}
    ) {
        const lock = await this.locker.acquireLock('file:' + path);

        let {id, version} = await this.exchangeDatabase.increase(this.fileType.classType, {path, ...fields}, {version: 1}, ['id']);

        try {
            let file: T | undefined;

            if (!id) {
                file = new this.fileType.classType(path);
                for (const i of eachKey(fields)) {
                    (file as any)[i] = (fields as any)[i];
                }
                file.mode = FileMode.streaming;
                id = file.id;
                if (!id) {
                    throw new Error('New file got no id? wtf');
                }
                version = 0;
            }

            const localPath = this.getLocalPathForId(id);
            const localDir = dirname(localPath);
            if (!await pathExists(localDir)) {
                await ensureDir(localDir);
            }

            await appendFile(localPath, data);
            const stats = await stat(localPath);

            if (options.cropSizeAt && options.cropSizeAtTo && stats.size > options.cropSizeAt) {
                if (options.cropSizeAtTo >= options.cropSizeAt) {
                    throw new Error('cropSizeAtTo is not allowed to be bigger than cropSizeAt.');
                }
                const content = await readFile(localPath);
                await writeFile(localPath, content.slice(stats.size - options.cropSizeAtTo));
            }

            if (file) {
                //when a subscribes is listening to this file,
                //we publish this only when the file is written to disk.
                await this.exchangeDatabase.add(this.fileType.classType, file);
            }

            this.exchange.publishFile(id, {
                type: 'append',
                version: version,
                path: path,
                size: stats.size,
                content: data.toString(), //todo, support binary
            });
        } finally {
            await lock.unlock();
        }
    }

    public async subscribe(path: string, fields: Partial<T>, encoding: 'binary'): Promise<StreamBehaviorSubject<Buffer | undefined>>;
    public async subscribe(path: string, fields: Partial<T>, encoding: 'utf8'): Promise<StreamBehaviorSubject<string | undefined>>;
    public async subscribe(path: string, fields: Partial<T> = {}, encoding: 'binary' | 'utf8' = 'binary'):
        Promise<StreamBehaviorSubject<Buffer | undefined> | StreamBehaviorSubject<string | undefined>> {

        const subject = new StreamBehaviorSubject<any>(undefined);

        const file = await this.findOne(path, fields);

        const streamContent = async (id: string) => {
            //it's important to stop writing/appending when we read initially the file
            //and then subscribe, otherwise we are hit by a race condition where it can happen
            //that we get older subscribeFile messages
            const lock = await this.locker.acquireLock('file:' + path);

            try {
                //read initial content
                const data = await this.read(path, fields);

                if (subject.isStopped) {
                    return;
                }

                subject.next(data ? (encoding === 'binary' ? data : data.toString('utf8')) : undefined);

                //it's important that this callback is called right after we returned the subject,
                //and subscribed to the subject, otherwise append won't work correctly and might be hit by a race-condition.
                const exchangeSubscription = await this.exchange.subscribeFile(id, async (message) => {
                    if (message.type === 'set') {
                        const data = await this.read(path, fields);
                        subject.next(data ? (encoding === 'binary' ? data : data.toString('utf8')) : undefined);
                    } else if (message.type === 'append') {
                        //message.size contains the new size after this append has been applied.
                        //this means we could track to avoid race conditions, but for the moment we use a lock.
                        //lock is acquired in stream() and makes sure we don't get file appends during
                        //reading and subscribing

                        subject.append(message.content);
                    } else if (message.type === 'remove') {
                        subject.next(undefined);
                    }
                });

                subject.addTearDown(() => {
                    if (exchangeSubscription && exchangeSubscription) {
                        exchangeSubscription.unsubscribe();
                    }
                });

            } finally {
                await lock.unlock();
            }
        };

        if (file) {
            await streamContent(file.id);
        } else {
            subject.next(undefined);

            this.exchangeDatabase.onCreation(this.fileType.classType, {
                path: path,
                ...fields
            }).subscribe((id) => {
                if (!subject.isStopped) {
                    streamContent(id);
                }
            });
        }

        return subject;
    }
}
