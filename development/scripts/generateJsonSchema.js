import { Schema } from "@lucania/schema";
import { File } from "@lucania/toolbox/server";
import { Configuration } from "@lucania/seam.framework/shared";

export function generateJsonSchema() {
    File.write("../jsonSchema/configuration.json", JSON.stringify(Schema.getJsonSchema(Configuration.Schema), undefined, "    "));
}