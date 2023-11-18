import { resolve } from "path";

export namespace Path {

    export namespace Directory {

        export const transient = ".transient";
        export const bundle = "bundle";
        export const plugins = "plugins";
        export const nodeModules = "node_modules";
        export const cache = "cache";

        export namespace Absolute {

            export const root = resolve(".");
            export const bundle = resolve(Path.Directory.Absolute.root, Path.Directory.bundle);
            export const transient = resolve(Path.Directory.Absolute.bundle, Path.Directory.transient);
            export const plugins = resolve(Path.Directory.Absolute.transient, Path.Directory.plugins);

            export namespace Plugin {

                export const nodeModules = resolve(Path.Directory.Absolute.plugins, Path.Directory.nodeModules);
                export const cache = resolve(Path.Directory.Absolute.plugins, Path.Directory.cache);

            }

        }

    }

    export namespace File {

        export const configuration = "configuration.json";
        export const packageJson = "package.json";
        export const exporter = "exporter.js";
        export const specifierNameMapping = "specifierNameMapping.json";

        export namespace Absolute {

            export const packageJson = resolve(Path.Directory.Absolute.root, Path.File.packageJson);
            export const configuration = resolve(Path.Directory.Absolute.bundle, Path.File.configuration);

            export namespace Plugin {

                export const exporter = resolve(Path.Directory.Absolute.plugins, Path.File.exporter);
                export const packageJson = resolve(Path.Directory.Absolute.plugins, Path.File.packageJson);

            }
        }

    }

}