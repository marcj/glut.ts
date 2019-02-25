import {Collection, JSONEntity} from '@marcj/glut-core';
import {Todo} from './model';

export interface ApiController {
    addTodo(todo: JSONEntity<Todo>);

    patch(id: string, patches: Partial<JSONEntity<Todo>>);

    remove(id: string);

    todos(): Promise<Collection<Todo>>;
}
