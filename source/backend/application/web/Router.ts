import createExpressEngine from "express";
import { Express as ExpressEngine } from "express-serve-static-core";
import type { Server } from "http";
import { Handler, Method } from "./Handler.js";
import { Endpoint } from "./Endpoint.js";
import { Data } from "@lucania/toolbox/shared";

export class Router {

    private static instance: Router | undefined;

    private _engine: ExpressEngine;
    private _server?: Server;

    private constructor() {
        this._engine = createExpressEngine();
    }

    public registerHandler(handler: Handler) {
        const register = this._getRegistrationFunction(handler.method);
        register(handler.path, handler.handle.bind(handler));
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

    private _getRegistrationFunction(method: Method) {
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

    public static getInstance(): Router {
        if (Router.instance === undefined) {
            Router.instance = new Router();
        }
        return Router.instance;
    }

}