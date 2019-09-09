import {EntitySubject, StreamBehaviorSubject, ValidationErrorItem, ValidationParameterError} from "./core";
import {Collection} from "./collection";
import {ServerMessageActionType} from "./contract";
import {eachKey, getClassName, isArray, isObject, isPlainObject} from "@marcj/estdlib";
import {classToPlain, partialClassToPlain, partialPlainToClass, plainToClass, RegisteredEntities, validate} from "@marcj/marshal";
import {Observable} from "rxjs";
import {map} from "rxjs/operators";

export type ActionTypes = { parameters: ServerMessageActionType[], returnType: ServerMessageActionType };

export async function executeActionAndSerialize(
    actionTypes: ActionTypes,
    controllerName: any,
    controllerInstance: any,
    methodName: string,
    args: any[]): Promise<any> {
    const fullName = `${getClassName(controllerInstance)}.${methodName}`;

    for (const i of eachKey(args)) {
        if (!actionTypes.parameters[i]) {
            continue;
        }

        const type = actionTypes.parameters[i];

        if (type.type === 'Entity' && type.entityName) {
            if (!RegisteredEntities[type.entityName]) {
                throw new Error(`Action's parameter ${fullName}:${i} has invalid entity referenced ${type.entityName}.`);
            }

            //todo, validate also partial objects, but @marcj/marshal needs an adjustments for the `validation` method to avoid Required() validator
            // otherwise it fails always.
            if (!type.partial) {
                const errors = validate(RegisteredEntities[type.entityName], args[i]);
                if (errors.length) {
                    throw new ValidationParameterError(
                        controllerName,
                        methodName,
                        i,
                        errors.map(error => new ValidationErrorItem(error.path, error.message, error.code, type.entityName!)));
                }
            }
            if (type.partial) {
                args[i] = partialPlainToClass(RegisteredEntities[type.entityName], args[i]);
            } else {
                args[i] = plainToClass(RegisteredEntities[type.entityName], args[i]);
            }
        }
    }

    let result = (controllerInstance as any)[methodName](...args);

    if (result && typeof (result as any)['then'] === 'function') {
        // console.log('its an Promise');
        result = await result;
    }

    if (result instanceof EntitySubject) {
        return result;
    }

    if (result instanceof StreamBehaviorSubject) {
        return result;
    }

    if (result instanceof Collection) {
        return result;
    }

    if (result === undefined) {
        return result;
    }

    const converter: { [name: string]: (v: any) => any } = {
        'Entity': (v: any) => {
            if (actionTypes.returnType.partial) {
                return partialClassToPlain(RegisteredEntities[actionTypes.returnType.entityName!], v);
            } else {
                return classToPlain(RegisteredEntities[actionTypes.returnType.entityName!], v);
            }
        },
        'Boolean': (v: any) => {
            return Boolean(v);
        },
        'Number': (v: any) => {
            return Number(v);
        },
        'Date': (v: any) => {
            return v;
        },
        'Plain': (v: any) => {
            return v;
        },
        'String': (v: any) => {
            return String(v);
        },
        'Object': (v: any) => {
            return v;
        }
    };

    function checkForNonObjects(v: any) {
        if (isArray(v) && v[0]) {
            v = v[0];
        }

        const prefix = `Action ${fullName}`;

        if (isObject(v) && !isPlainObject(v)) {
            throw new Error(`${prefix} returns an not annotated custom class instance (${getClassName(v)}) that can not be serialized.\n` +
                `Use e.g. @ReturnType(MyClass) at your action.`);
        } else if (isObject(v) && actionTypes.returnType.type !== 'Plain' && actionTypes.returnType.type !== 'Any') {
            throw new Error(`${prefix} returns an not annotated object literal that can not be serialized.\n` +
                `Use either @ReturnPlainObject() to avoid serialisation using Marshal.ts, or (better) create an Marshal.ts entity and use @ReturnType(MyEntity) at your action.`);
        }
    }

    if (result instanceof Observable) {
        return result.pipe(map((v) => {
            if (actionTypes.returnType.type === 'undefined') {
                checkForNonObjects(v);

                return v;
            }

            if (isArray(v)) {
                return v.map((j: any) => converter[actionTypes.returnType.type](j));
            }

            return converter[actionTypes.returnType.type](v);
        }));
    }

    if (actionTypes.returnType.type === 'undefined') {
        checkForNonObjects(result, );

        return result;
    }

    if (actionTypes.returnType.type === 'Object') {
        checkForNonObjects(result);

        return result;
    }

    if (isArray(result)) {
        return result.map((v: any) => converter[actionTypes.returnType.type](v));
    }

    return converter[actionTypes.returnType.type](result);
}
