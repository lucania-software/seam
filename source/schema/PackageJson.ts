import { Schema } from "@lucania/schema"

const { build } = Schema;

export namespace PackageJson {

    export const Schema = build((type) => ({
        name: type.string.required(),
        type: type.string.optional(),
        main: type.string.optional(),
        files: type.array(type.string).optional(),
        exports: type.dynamic(type.logic.or(
            type.string,
            {
                node: type.string.optional(),
                default: type.string.optional()
            }
        )).optional(),
        dependencies: type.dynamic(type.string).optional()
    }));

    export type Type = Schema.Model<typeof Schema>;

}