import { Handler, Method } from "../Handler.js";

export class CatchAllHandler extends Handler {

    public constructor() {
        super(Method.GET, "*", (request, response, next) => {
            response.end("No handlers defined to handle this request.");
        });
    }

}