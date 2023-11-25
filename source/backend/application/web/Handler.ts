import { Data } from "@lucania/toolbox/shared";
import type { Query, NextFunction, Request, Response, RouteParameters } from "express-serve-static-core";

export enum Method {

    GET,
    HEAD,
    POST,
    PUT,
    DELETE,
    CONNECT,
    OPTIONS,
    TRACE,
    PATCH

}

export enum Priority {

    HIGHEST = 1,
    HIGH = 3,
    NORMAL = 5,
    LOW = 7,
    LOWEST = 10

}

export type HandleFunction<
    RequestBody = any,
    ResponseBody = any,
    RequestQuery extends Query = Query,
    Locals extends Record<string, any> = Record<string, any>,
    Path extends string = string,
    Parameters = RouteParameters<Path>
> = (
    request: Request<Path, ResponseBody, RequestBody, RequestQuery, Locals>,
    response: Response<RequestBody, Locals>,
    next: NextFunction
) => Promise<void> | void;

export type HandlerOptions<Path extends string> = {
    method: Method,
    path: Path,
    priority?: number
};

export class Handler<
    RequestBody = any,
    ResponseBody = any,
    RequestQuery extends Query = Query,
    Locals extends Record<string, any> = Record<string, any>,
    Path extends string = string,
    Parameters = RouteParameters<Path>
> {

    public readonly method: Method;
    public readonly path: Path;
    public readonly priority: number;

    protected _handle: HandleFunction<RequestBody, ResponseBody, RequestQuery, Locals, Path, Parameters>;

    public constructor(options: HandlerOptions<Path>, handle: HandleFunction<RequestBody, ResponseBody, RequestQuery, Locals, Path, Parameters>) {
        this.method = options.method;
        this.path = options.path;
        this.priority = Data.get(options, "priority", Priority.NORMAL);
        this._handle = handle;
    }

    public get handle() {
        return this._handle;
    }

}