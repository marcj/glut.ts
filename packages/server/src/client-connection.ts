import {Injectable, Injector} from "injection-js";
import {Observable} from "rxjs";
import {Application, SessionStack} from "./application";
import {ClientMessageAll, ServerMessageActionType} from "@marcj/glut-core";
import {ConnectionMiddleware} from "./connection-middleware";
import {ConnectionWriter} from "./connection-writer";
import {arrayRemoveItem, each, eachKey} from "@marcj/estdlib";
import {getActionParameters, getActionReturnType, getActions} from "./decorators";
import {plainToClass, RegisteredEntities, validate} from "@marcj/marshal";

type ActionTypes = { parameters: ServerMessageActionType[], returnType: ServerMessageActionType };

@Injectable()
export class ClientConnection {
    protected timeoutTimers: NodeJS.Timeout[] = [];
    protected destroyed = false;
    protected usedControllers: { [path: string]: any } = {};

    private cachedActionsTypes: {
        [controllerName: string]: { [actionName: string]: ActionTypes }
    } = {};

    constructor(
        protected app: Application,
        protected sessionStack: SessionStack,
        protected injector: Injector,
        protected connectionMiddleware: ConnectionMiddleware,
        protected writer: ConnectionWriter,
    ) {
    }

    public destroy() {
        this.connectionMiddleware.destroy();
        this.destroyed = true;

        for (const timeout of this.timeoutTimers) {
            clearTimeout(timeout);
        }

        for (const usedController of each(this.usedControllers)) {
            if (usedController.destroy) {
                usedController.destroy();
            }
        }
    }

    public isActive(): boolean {
        return !this.destroyed;
    }

    /**
     * Creates a regular timer using setTimeout() and automatically cancel it once the connection breaks or server stops.
     */
    public setTimeout(cb: () => void, timeout: number): NodeJS.Timeout {
        const timer = setTimeout(() => {
            cb();
            arrayRemoveItem(this.timeoutTimers, timer);
        }, timeout);
        this.timeoutTimers.push(timer);
        return timer;
    }

    public async onMessage(raw: string) {
        if ('string' === typeof raw) {
            const message = JSON.parse(raw) as ClientMessageAll;

            if (message.name === 'action') {
                // console.log('Got action', message);
                try {
                    this.actionSend(message, () => this.action(message.controller, message.action, message.args));
                } catch (error) {
                    console.log('Unhandled action error', error);
                }
            }

            if (message.name === 'actionTypes') {
                try {
                    const {parameters, returnType} = await this.getActionTypes(message.controller, message.action);

                    this.writer.write({
                        type: 'actionTypes/result',
                        id: message.id,
                        returnType: returnType,
                        parameters: parameters,
                    });
                } catch (error) {
                    this.writer.sendError(message.id, error);
                }
            }

            if (message.name === 'authenticate') {
                this.sessionStack.setSession(await this.app.authenticate(this.injector, message.token));

                this.writer.write({
                    type: 'authenticate/result',
                    id: message.id,
                    result: this.sessionStack.isSet(),
                });
            }

            await this.connectionMiddleware.messageIn(message);
        }
    }

    public async getActionTypes(controller: string, action: string)
        : Promise<ActionTypes> {

        if (!this.cachedActionsTypes[controller]) {
            this.cachedActionsTypes[controller] = {};
        }

        if (!this.cachedActionsTypes[controller][action]) {

            const controllerClass = await this.app.resolveController(controller);

            if (!controllerClass) {
                throw new Error(`Controller not found for ${controller}`);
            }

            const access = await this.app.hasAccess(this.injector, this.sessionStack.getSession(), controllerClass, action);
            if (!access) {
                throw new Error(`Access denied`);
            }

            const actions = getActions(controllerClass);

            if (!actions[action]) {
                console.log('Action unknown, but method exists.', action);
                throw new Error(`Action unknown ${action}`);
            }

            this.cachedActionsTypes[controller][action] = {
                parameters: getActionParameters(controllerClass, action),
                returnType: getActionReturnType(controllerClass, action)
            };
        }

        return this.cachedActionsTypes[controller][action];
    }

    public async action(controller: string, action: string, args: any[]): Promise<any> {
        const controllerClass = await this.app.resolveController(controller);

        if (!controllerClass) {
            throw new Error(`Controller not found for ${controller}`);
        }

        const access = await this.app.hasAccess(this.injector, this.sessionStack.getSession(), controllerClass, action);
        if (!access) {
            throw new Error(`Access denied`);
        }

        const controllerInstance = this.injector.get(controllerClass);

        this.usedControllers[controller] = controllerInstance;

        const methodName = action;
        const fullName = `${controller}::${action}`;

        if ((controllerInstance as any)[methodName]) {
            const actions = getActions(controllerClass);

            if (!actions[methodName]) {
                console.log('Action unknown, but method exists.', fullName);
                throw new Error(`Action unknown ${fullName}`);
            }

            const types = await this.getActionTypes(controller, action);

            for (const i of eachKey(args)) {
                const type = types.parameters[i];
                if (type.type === 'Entity' && type.entityName) {
                    if (!RegisteredEntities[type.entityName]) {
                        throw new Error(`Action's parameter ${controller}::${name}:${i} has invalid entity referenced ${type.entityName}.`);
                    }

                    const errors = await validate(RegisteredEntities[type.entityName], args[i]);
                    if (errors.length) {
                        //todo, wrapp in own ValidationError so we can serialise it better when send to the client
                        throw new Error(`${fullName} validation failed: ` + JSON.stringify(errors));
                    }
                    args[i] = plainToClass(RegisteredEntities[type.entityName], args[i]);
                }
            }

            try {
                return (controllerInstance as any)[methodName](...args);
            } catch (error) {
                // possible security whole, when we send all errors.
                console.error(error);
                throw new Error(`Action ${fullName} failed: ${error}`);
            }
        }

        console.error('Action unknown', fullName);
        throw new Error(`Action unknown ${fullName}`);
    }

    public async actionSend(message: ClientMessageAll, exec: (() => Promise<any> | Observable<any>)) {
        try {
            let result = exec();

            if (typeof (result as any)['then'] === 'function') {
                // console.log('its an Promise');
                result = await result;
            }

            await this.connectionMiddleware.actionMessageOut(message, result);
        } catch (error) {
            console.log('Worker execution error', message, error);
            await this.writer.sendError(message.id, error);
        }
    }
}