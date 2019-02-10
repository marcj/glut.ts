import {BooleanType, Entity, StringType, NumberType, uuid} from '@marcj/marshal';
import {IdInterface} from '@kamille/core';

@Entity('todo')
export class Todo implements IdInterface {

    @StringType()
    id: string = uuid();

    @NumberType()
    version = 1;

    @BooleanType()
    completed: Boolean;

    @BooleanType()
    editing: Boolean;

    @StringType()
    title: String;

    constructor(title: String) {
        this.completed = false;
        this.editing = false;
        this.title = title.trim();
    }
}
