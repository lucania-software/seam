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

type HandleFunction<
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

export abstract class Handler<
    RequestBody = any,
    ResponseBody = any,
    RequestQuery extends Query = Query,
    Locals extends Record<string, any> = Record<string, any>,
    Path extends string = string,
    Parameters = RouteParameters<Path>
> {

    public readonly method: Method;
    public readonly path: Path;

    protected _handle: HandleFunction<RequestBody, ResponseBody, RequestQuery, Locals, Path, Parameters>;

    public constructor(method: Method, path: Path, handle: HandleFunction<RequestBody, ResponseBody, RequestQuery, Locals, Path, Parameters>) {
        this.method = method;
        this.path = path;
        this._handle = handle;
    }

    public get handle() {
        return this._handle;
    }

}