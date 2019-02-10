import {Collection, JSONEntity} from '@kamille/core';
import {Todo} from './model';

export interface ApiController {
    addTodo(todo: JSONEntity<Todo>);

    patch(id: string, patches: Partial<JSONEntity<Todo>>);

    remove(id: string);

    todos(): Promise<Collection<Todo>>;
}
