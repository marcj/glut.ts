import {BooleanType, Entity, StringType, NumberType, uuid, ID} from '@marcj/marshal';
import {IdInterface} from '@marcj/glut-core';

@Entity('todo')
export class Todo implements IdInterface {

    @ID()
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
