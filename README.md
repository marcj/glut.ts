# Glut.ts

[![Build Status](https://travis-ci.com/marcj/glut.ts.svg?branch=master)](https://travis-ci.com/marcj/glut.ts)
[![Coverage Status](https://coveralls.io/repos/github/marcj/glut.ts/badge.svg?branch=master)](https://coveralls.io/github/marcj/glut.ts?branch=master)

`@marcj/glut-core` [![npm version](https://badge.fury.io/js/%40marcj%2Fglut-core.svg)](https://badge.fury.io/js/%40marcj%2Fglut-core)

`@marcj/glut-server` [![npm version](https://badge.fury.io/js/%40marcj%2Fglut-server.svg)](https://badge.fury.io/js/%40marcj%2Fglut-server)

`@marcj/glut-client`  [![npm version](https://badge.fury.io/js/%40marcj%2Fglut-client.svg)](https://badge.fury.io/js/%40marcj%2Fglut-client)


Glust.ts is a reactive data streaming distribution real-time app framework for modern client/server architectures 
based on [rxJS](https://github.com/ReactiveX/rxjs).

It's suited for streaming data and entities between your client <-> server. Glut.ts automatically converts and validates the data
for the transport via WebSockets, so you have only one entity schema and one controller interface defined for both, server and client. 

The controller based architecture allows you to strictly type against an interface and allow the client to
directly detect changes in the interface by typescript's type checking. 

This increases the development time for client server communications dramatically
since you don't need to define entities multiple times in different languages and don't need to invent a new protocol
to send, convert, and validate data that is transmitted between server and client. 

Automatic serialisation from and to JSON is done using [@marcj/marshal](https://github.com/marcj/marshal).

## Install

Client:

```
npm install @marcj/glut-client @marcj/glut-core reflect-metadata rxjs
```

Server:

```
npm install @marcj/glut-server @marcj/glut-core reflect-metadata rxjs buffer
```

## Example


#### Server

```typescript

@Controller('user')
class UserController implements UserControllerInterface{

    @Action()
    names(): string {
        return ['name1', 'name2'];
    }
    
    @Action()
    users(): Observable<User> {
        return new Observable((observer) => {
            observer.next(new User('Peter 1'));
            
            setTimeout(() =>{
                observer.next(new User('Peter 2'));
                observer.complete();
            }, 1000);
        });
    }
    
    @Action()
    userList(): Collection<User> {
        const collection = new Collection(User);
        collection.add(new User('Peter 1'));
        collection.add(new User('Peter 2'));
        collection.add(new User('Peter 3'));
        collection.loaded();
        
        setTimeout(() => {
            //whenever you change the collection, we send the operations to the client
            //and keep everything in sync
            collection.add(new User('Peter 4'));
        }, 1000);
        
        return collection;
    }
}

@ApplicationModule({
    controllers: [UserController],
    connectionProviders: [],
    notifyEntities: [User],
})
class MyApp extends Application {
    async bootstrap(): Promise<any> {
        await super.bootstrap();
        console.log('bootstrapped =)');
    }

    async authenticate(token: any): Promise<Session> {
        console.log('authenticate', token);
        return super.authenticate(token);
    }
}

const app = ApplicationServer.createForModule(MyApp);
app.start();
```

#### Client
 
```typescript
const socket = new SocketClient();
const user = socket.controller<UserControllerInterface>('user');

// Simple array transmission
const names = await user.names();
console.log(names); // ['name1', 'name2']


//Observable for streamed data
(await user.users()).subscribe(nextUser => {
    console.log('got user', nextUser);  
});


//Collection for streamed lists of entities
const userCollection = await user.userList();
userCollection.subscribe(list => {
    console.log('list updated', list);  
});
//or
await userCollection.readyState;
console.log('list ready', userCollection.count(), userCollection.all());
```

#### Common package / Shared between server and client

```typescript
@Entity('user')
class User implements IdInterface {
    @StringType()
    id: string = uuid();

    @NumberType()
    version: number = 1;

    @StringType()
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

interface UserControllerInterface {
    names(): string[];

    users(): Observable<User>;

    userList(): Collection<User>;
}
```
