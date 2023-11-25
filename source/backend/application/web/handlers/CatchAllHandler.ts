import { Handler, Method, Priority } from "../Handler.js";

export class CatchAllHandler extends Handler {

    public constructor() {
        super(
            {
                method: Method.GET,
                path: "*",
                priority: Priority.LOWEST
            }, (request, response, next) => {
                response.end("No handlers defined to handle this request.");
            }
        );
    }

}