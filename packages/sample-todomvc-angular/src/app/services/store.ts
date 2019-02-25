import {Todo} from '../../model';
import {SocketClient} from '@marcj/glut-client';
import {ApiController} from '../../contract';
import {classToPlain} from '@marcj/marshal';
import {Collection} from '@marcj/glut-core';


export class TodoStore {
    public todos?: Collection<Todo>;
    protected socket = new SocketClient();
    public todoApi: ApiController;

    constructor() {
        this.todoApi = this.socket.controller<ApiController>('todos');
        this.todoApi.todos().then((todos) => {
            console.log('todos', todos);
            this.todos = todos;
            this.todos.subscribe((todos) => {
                console.log('updated todos', todos);
            })
        });
    }

    private getWithCompleted(completed: Boolean): Todo[] {
        return this.todos!.all().filter((todo: Todo) => todo.completed === completed);
    }

    allCompleted() {
        return this.todos!.all().length === this.getCompleted().length;
    }

    setAllTo(completed: Boolean) {
        // this.todos.forEach((t: Todo) => t.completed = completed);
        // this.updateStore();
    }

    removeCompleted() {
        for (const todo of this.getWithCompleted(true)) {
            this.todoApi.remove(todo.id);
        }
    }

    getRemaining() {
        return this.getWithCompleted(false);
    }

    getCompleted() {
        return this.getWithCompleted(true);
    }

    toggleCompletion(todo: Todo) {
        this.todoApi.patch(todo.id, {completed: !todo.completed});
    }

    remove(todo: Todo) {
        this.todoApi.remove(todo.id);
    }

    add(title: String) {
        const todo = new Todo(title);
        this.todoApi.addTodo(classToPlain(Todo, todo));
    }
}
