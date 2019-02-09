import {ClassType, plainToClass, propertyPlainToClass, RegisteredEntities} from "@marcj/marshal";
import {Subscriber} from "rxjs";
import {Collection, CollectionStream, eachPair, IdInterface, ServerMessageEntity} from "@kamille/core";
import {set} from 'dot-prop';

class StoreItem<T> {
    instance: T | undefined;
    deleted: boolean = false;
    observers: Subscriber<T>[] = [];

    constructor(instance: T | undefined) {
        this.instance = instance;
    }
}

class ItemsStore<T> {
    items: { [id: string]: StoreItem<any> } = {};
    protected observerId = 0;

    public getOrCreateItem(id: string): StoreItem<T> {
        if (!this.items[id]) {
            this.items[id] = new StoreItem(undefined);
        }

        return this.items[id];
    }

    public removeItemAndNotifyObservers(id: string) {
        delete this.items[id];
        for (const ob of this.items[id].observers) {
            ob.next(undefined);
            ob.complete();
        }
    }

    public notifyObservers(id: string) {
        for (const ob of this.items[id].observers) {
            ob.next(this.items[id].instance);
        }
    }

    public setItemAndNotifyObservers(id: string, item: T): StoreItem<T> {
        if (!this.items[id]) {
            this.items[id] = new StoreItem(item);
        } else {
            this.items[id].instance = item;
            //todo, add throttling
            for (const ob of this.items[id].observers) {
                ob.next(item);
            }
        }

        return this.items[id];
    }

    public hasItem(id: string): boolean {
        return !!this.items[id];
    }

    public addObserver(id: string, observer: Subscriber<T>) {
        const item = this.getOrCreateItem(id);
        item.observers.push(observer);
        (observer as any)['_id'] = ++this.observerId;
    }

    public hasObservers(id: string): boolean {
        if (this.hasItem(id)) {
            const item = this.getOrCreateItem(id);
            return item.observers.length > 0;
        }

        return false;
    }

    public removeObserver(id: string, observer: Subscriber<T>) {
        if (this.hasItem(id)) {
            const item = this.getOrCreateItem(id);
            const index = item.observers.indexOf(observer);
            if (-1 !== index) {
                item.observers.splice(index, 1);
            }

            if (item.observers.length === 0) {
                delete this.items[id];
            }
        }
    }
}

export class EntityState {
    private readonly items = new Map<ClassType<any>, ItemsStore<any>>();

    private getStore<T>(classType: ClassType<T>): ItemsStore<T> {
        let store = this.items.get(classType);

        if (!store) {
            store = new ItemsStore;
            this.items.set(classType, store);
        }

        return store;
    }

    public handleEntityMessage<T extends IdInterface>(stream: ServerMessageEntity) {
        const classType = RegisteredEntities[stream.entityName];
        const store = this.getStore(classType);

        if (stream.type === 'entity/update') {
            if (store.hasItem(stream.id)) {
                const item = plainToClass(classType, stream.item);
                store.setItemAndNotifyObservers(stream.id, item);
            }
        }

        if (stream.type === 'entity/patch') {
            if (store.hasItem(stream.id)) {
                const toVersion = stream.version;
                const storeItem = store.getOrCreateItem(stream.id);

                if (storeItem.instance && storeItem.instance.version < toVersion) {
                    //it's important to not patch old versions
                    for (const [i, v] of eachPair(stream.patch)) {
                        const vc = propertyPlainToClass(classType, i, v, [], 0, {onFullLoadCallbacks: []});
                        set(storeItem.instance, i, vc);
                    }

                    storeItem.instance.version = toVersion;
                    store.notifyObservers(stream.id);
                }
            }
        }

        if (stream.type === 'entity/remove') {
            if (store.hasItem(stream.id)) {
                store.removeItemAndNotifyObservers(stream.id);
            }
        }

    }

    public handleCollectionNext<T extends IdInterface>(collection: Collection<T>, stream: CollectionStream) {
        const classType = collection.classType;
        const store = this.getStore(classType);

        const observers: { [id: string]: Subscriber<T> } = {};

        if (stream.type === 'set') {
            for (const itemRaw of stream.items) {
                if (!store.hasItem(itemRaw.id)) {
                    const item = plainToClass(classType, itemRaw);
                    store.setItemAndNotifyObservers(item.id, item);
                }
                const instance = store.getOrCreateItem(itemRaw.id).instance;
                if (instance) {
                    collection.add(instance, false);
                    observers[itemRaw.id] = new Subscriber((i) => {
                        collection.deepChange.next(i);
                        collection.loaded();
                    });
                    store.addObserver(itemRaw.id, observers[itemRaw.id]);
                }
            }
        }

        if (stream.type === 'ready') {
            collection.loaded();
        }

        if (stream.type === 'remove') {
            collection.remove(stream.id);
            store.removeObserver(stream.id, observers[stream.id]);

            if (collection.isLoaded) {
                collection.loaded();
            }
        }

        if (stream.type === 'add') {
            if (!store.hasItem(stream.item.id)) {
                const item = plainToClass(classType, stream.item);
                store.setItemAndNotifyObservers(stream.item.id, item);
            }

            const instance = store.getOrCreateItem(stream.item.id).instance;
            if (instance) {
                observers[stream.item.id] = new Subscriber((i) => {
                    collection.deepChange.next(i);
                    if (collection.isLoaded) {
                        collection.loaded();
                    }
                });
                store.addObserver(stream.item.id, observers[stream.item.id]);
                collection.add(instance);
            }
        }
    }
}
