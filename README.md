# Kamille.js

Kamille is a reactive data streaming distribution real-time app framework for modern client/server architectures 
based on [rxJS](https://github.com/ReactiveX/rxjs).

It's suited for streaming data and entities between your client <-> server. Kamille automatically converts and validates the data
for the transport via WebSockets, so you have only one entity schema and one controller interface defined for both, server and client. 

The controller based architecture allows you to strictly type against an interface and allow the client to
directly detect changes in the interface by typescripts type checking. 

This increases the development time for client server communications dramatically
since you don't need to define entities multiple times in different languages and don't need to invent a new protocol
to send, convert and validate data that is transmitted between server and client. 

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
        return ['name1', 'name2'];
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
await userCollection.ready.toPromise();
console.log('list ready', userCollection.count(), userCollection.all());
```

#### Common package / Shared between server and client

```typescript
@Entity('user')
class User implements IdInterface {
    @StringType()
    id!: string;

    @NumberType()
    version!: number;

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
