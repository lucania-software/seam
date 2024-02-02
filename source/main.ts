import { Seam } from "./Seam.js";

// Create an instance of Seam.
const seam = new Seam({ rootDirectory: "test" });

// // Ensure you're not running outdated plugins.
// await seam.uninstallAllPlugins();

// // Install plugins via NPM specifiers.
// const pluginNames = await seam.installPlugins("C:/Users/Jeremy/Storage/Programming/Web/@freecore/plugins/essentials");

// // Continue with only valid plugins.
// const validPluginNames = pluginNames.reduce((names, name) => name === undefined ? names : [...names, name], <string[]>[]);

const validPluginNames = ["@freecore/plugin.essentials"];

// Register the valid plugins.
await seam.registerPlugins(...validPluginNames);

