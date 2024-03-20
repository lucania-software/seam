import { $ } from "@lucania/schema"

export namespace PackageJson {

    export const Schema = $.Object({
        name: $.String(),
        type: $.String(false),
        main: $.String(false),
        files: $.Array($.String(), true, []),
        exports: $.DynamicObject(
            $.OrSet($.Members(
                $.String(),
                $.Object({ node: $.String(false), default: $.String(false) })
            )),
            true, {}
        ),
        dependencies: $.DynamicObject($.String(), true, {}),
        config: $.Any(true, {})
    });

    export type Type = $.Model<typeof Schema>;

}