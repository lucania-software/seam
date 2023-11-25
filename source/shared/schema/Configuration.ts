import { Schema } from "@lucania/schema";

const { build } = Schema;

export namespace Configuration {

    export const Schema = build((type) => ({
        web: {
            host: type.string,
            port: type.number
        },
        plugins: type.array(type.string).default([])
    }));

    export type Type = Schema.Model<typeof Schema>;

}