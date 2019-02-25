import 'reflect-metadata';
import {Collection, JSONEntity} from '@marcj/glut-core';
import {Todo} from './model';
import {Action, Application, ApplicationModule, ApplicationServer, Controller, EntityStorage, ExchangeDatabase, Session} from '@marcj/glut-server';
import {plainToClass, partialPlainToClass} from '@marcj/marshal';
import {ApiController} from './contract';

@Controller('todos')
class UserController implements ApiController {
    constructor(private storage: EntityStorage, private database: ExchangeDatabase) {
    }

    @Action()
    async addTodo(todo: JSONEntity<Todo>) {
        await this.database.add(Todo, plainToClass(Todo, todo));
    }

    @Action()
    async patch(id: string, patches: Partial<JSONEntity<Todo>>) {
        await this.database.patch(Todo, id, partialPlainToClass(Todo, patches));
    }

    @Action()
    async remove(id: string) {
        await this.database.remove(Todo, id);
    }

    @Action()
    async todos(): Promise<Collection<Todo>> {
        return await this.storage.find(Todo);
    }
}

@ApplicationModule({
    controllers: [UserController],
    connectionProviders: [],
    notifyEntities: [Todo],
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
