import { Data, Error } from "@lucania/toolbox/shared";
import createExpressEngine from "express";
import { Express as ExpressEngine } from "express-serve-static-core";
import type { Server } from "http";
import type { HandleFunction } from "./Handler.js";
import { Handler, Method } from "./Handler.js";

type IdentifiedHandleFunction = HandleFunction & { engineHandlerFunctionId?: number };

type Layer = {
    handle: IdentifiedHandleFunction;
    route: Route;
    forId?: number
};

type Route = {
    stack: Layer[]
};

type BoundDispatchContext = { boundDispatch: Layer, parent: Route };

export class Router {

    private static instance: Router | undefined;

    private _engine: ExpressEngine;
    private _server?: Server;
    private _engineHandlerFunctionId: number;
    private _handlerMapping: Record<number, Handler>;

    private constructor() {
        this._engine = createExpressEngine();
        this._engineHandlerFunctionId = 1;
        this._handlerMapping = {};
    }

    public registerHandler(handler: Handler) {
        const register = this._getEngineRegistrationFunction(handler.method);
        const handleFunction = handler.handle.bind(handler) as IdentifiedHandleFunction;
        const id = this._engineHandlerFunctionId++;
        handleFunction.engineHandlerFunctionId = id;
        register(handler.path, handleFunction);
        const context = Router._extractBoundDispatch(id, this._engine._router);
        Data.assert(context !== undefined, `Failed to find bound dispatch for handler ID ${id}.`);
        Data.assert(context.parent === this._engine._router, "Bound dispatch parent differs from engine's router root.");
        this._handlerMapping[id] = handler;
        const length = this._engine._router.stack.length;
        for (let i = 0; i <= length && length === this._engine._router.stack.length; i++) {
            if (i === length) {
                context.parent.stack.splice(i, 0, context.boundDispatch);
            } else {
                const layer: Layer = this._engine._router.stack[i];
                if (typeof layer.forId === "number") {
                    const registeredHandler = this._handlerMapping[layer.forId];
                    Data.assert(registeredHandler !== undefined, `Failed to find registered handler for a bound dispatch layer (ID "${layer.forId}").`);
                    if (handler.priority < registeredHandler.priority) {
                        context.parent.stack.splice(i, 0, context.boundDispatch);
                    }
                }
            }
        }
        return handleFunction.engineHandlerFunctionId;
    }

    public registerHandlers(...handlers: Handler[]) {
        return handlers.map((handler) => this.registerHandler(handler));
    }

    public unregisterHandler(handlerId: number) {
        this._removeEngineRoute(handlerId);
        delete this._handlerMapping[handlerId];
    }

    public unregisterHandlers(...handlerIds: number[]) {
        handlerIds.forEach((handlerId) => this.unregisterHandler(handlerId));
    }

    public async start(port: number, host?: string) {
        return new Promise<void>((resolve) => {
            if (host === undefined) {
                this._server = this._engine.listen(port, resolve);
            } else {
                this._server = this._engine.listen(port, host, resolve);
            }
        });
    }

    public async stop() {
        return new Promise<void>((resolve, reject) => {
            Data.assert(this._server !== undefined, "Attempted to stop router before it was started.");
            this._server.close((error) => error === undefined ? resolve() : reject(error));
        });
    }

    private _getEngineRegistrationFunction(method: Method) {
        switch (method) {
            case Method.GET: return this._engine.get.bind(this._engine);
            case Method.HEAD: return this._engine.head.bind(this._engine);
            case Method.POST: return this._engine.post.bind(this._engine);
            case Method.PUT: return this._engine.put.bind(this._engine);
            case Method.DELETE: return this._engine.delete.bind(this._engine);
            case Method.CONNECT: return this._engine.connect.bind(this._engine);
            case Method.OPTIONS: return this._engine.options.bind(this._engine);
            case Method.TRACE: return this._engine.trace.bind(this._engine);
            case Method.PATCH: return this._engine.patch.bind(this._engine);
        }
    }

    private static _extractBoundDispatch(id: number, route: Route, context?: BoundDispatchContext): BoundDispatchContext | undefined {
        for (let i = 0; i < route.stack.length; i++) {
            const layer = route.stack[i];
            if (typeof layer.route === "object" && layer.handle.name === "bound dispatch") {
                const context = Router._extractBoundDispatch(id, layer.route, { boundDispatch: layer, parent: route });
                if (context !== undefined) {
                    return context;
                }
            } else if (layer.handle.engineHandlerFunctionId === id) {
                if (context === undefined) {
                    throw new Error.Fatal(`Found engine handler function with ID "${id}" without first traversing a "bound dispatch" layer.`);
                } else {
                    const boundDispatchIndex = context.parent.stack.indexOf(context.boundDispatch);
                    Data.assert(boundDispatchIndex !== -1, `Failed to find "bound dispatch" in context's parent!`);
                    context.parent.stack.splice(boundDispatchIndex, 1);
                    context.boundDispatch.forId = id;
                    return context;
                }
            }
        }
        return undefined;
    }

    private _removeEngineRoute(id: number, route: Route | undefined = this._engine._router) {
        if (route !== undefined) {
            for (let i = 0; i < route.stack.length; i++) {
                const layer = route.stack[i];
                if (typeof layer.route === "object" && layer.handle.name === "bound dispatch") {
                    if (this._removeEngineRoute(id, layer.route)) {
                        if (route.stack[i].route.stack.length === 0) {
                            route.stack.splice(i, 1);
                            return true;
                        }
                    }
                } else if (layer.handle.engineHandlerFunctionId === id) {
                    route.stack.splice(i, 1);
                    return true;
                }
            }
        }
        return false;
    }

    public static getInstance(): Router {
        if (Router.instance === undefined) {
            Router.instance = new Router();
        }
        return Router.instance;
    }

}