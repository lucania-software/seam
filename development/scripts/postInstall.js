import { generateJsonSchema } from "./generateJsonSchema.js";
import { Path } from "@lucania/seam.framework/backend";
import { File } from "@lucania/toolbox/server";
import { ConsoleColor } from "@lucania/toolbox/shared";

(async () => {
    generateJsonSchema();
    if (!await File.exists(Path.Directory.Absolute.bundle)) {
        const { yellow, underscore, reset } = ConsoleColor.Common;
        console.info(
            `${yellow}You don't appear to have a bundle installed! ` +
            `To run the seam framework, you'll need to install a bundle at "${underscore}${Path.Directory.Absolute.bundle}${reset + yellow}"!${reset}`

        );
    }
})();