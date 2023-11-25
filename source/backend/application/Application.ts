import { Schema } from "@lucania/schema";
import { Data } from "@lucania/toolbox/shared";
import { CommandLine } from "./CommandLine.js";
import { Configuration } from "./Configuration.js";
import { PluginManager } from "./plugin/PluginManager.js";
import { Router } from "./web/Router.js";
import { Handler, Method, Priority } from "./web/Handler.js";

export class Application {

    private static instance: Application | undefined;

    public async start() {
        try {
            const configuration = Configuration.getInstance();
            const commandLine = CommandLine.getInstance();
            const pluginManager = PluginManager.getInstance();
            const router = Router.getInstance();

            router.registerHandler(new Handler({
                method: Method.GET,
                path: "*/:cow",
                priority: Priority.LOWEST,
                handle: (request, response, next) => {
                    response.end("No handlers defined to handle this request.");
                }
            }));

            router.registerHandler(new Handler<string, any, any, { command?: string }>({
                method: Method.GET,
                path: "/api/development",
                handle: async (request, response) => {
                    Data.assert(request.query.command !== undefined, "Please specify a command you wish to execute.");
                    await commandLine.execute(request.query.command.replaceAll(/_/g, " "));
                    response.end();
                }
            }));

            commandLine.registerCommand("stop", () => this.stop());
            commandLine.registerCommand("reload", (pluginName) => {
                Data.assert(pluginName !== undefined, "Please specify the name of the plugin you wish to reload.");
                const plugin = pluginManager.getPlugin(pluginName);
                Data.assert(plugin !== undefined, `There are no plugins registered with the name "${pluginName}".`);
                pluginManager.reload(plugin);
            });
            commandLine.registerCommand("load", (pluginName) => {
                Data.assert(pluginName !== undefined, "Please specify the name of the plugin you wish to reload.");
                const plugin = pluginManager.getPlugin(pluginName);
                Data.assert(plugin !== undefined, `There are no plugins registered with the name "${pluginName}".`);
                pluginManager.load(plugin);
            });
            commandLine.registerCommand("unload", (pluginName) => {
                Data.assert(pluginName !== undefined, "Please specify the name of the plugin you wish to reload.");
                const plugin = pluginManager.getPlugin(pluginName);
                Data.assert(plugin !== undefined, `There are no plugins registered with the name "${pluginName}".`);
                pluginManager.unload(plugin, false);
            });
            commandLine.registerCommand("test", async () => {
                await pluginManager.reload("@lucania/seam.plugin.essentials");
            });

            await configuration.load();
            commandLine.start();

            await pluginManager.setup(configuration.raw.plugins);
            await pluginManager.loadAll();

            console.info(`Started web server running at ${configuration.raw.web.host}:${configuration.raw.web.port}.`);
            await router.start(configuration.raw.web.port, configuration.raw.web.host);

            configuration.on("change", async (path: string) => {
                if (["web.host", "web.port"].includes(path)) {
                    console.info("Detected changes to router configuration...");
                    await router.stop();
                    await router.start(configuration.raw.web.port, configuration.raw.web.host);
                    console.info(`Restarted router. Now running at ${configuration.raw.web.host}:${configuration.raw.web.port}.`);
                }
                if (path.startsWith("plugins")) {
                    console.info("Detected changes to plugin configuration...");
                    await pluginManager.unloadAll(true);
                    await pluginManager.setup(configuration.raw.plugins);
                    await pluginManager.loadAll();
                }
            });
        } catch (error) {
            if (error instanceof Schema.ValidationError) {
                console.error(error.message);
            } else {
                console.error(error);
            }
        }
    }

    public async stop() {
        const pluginManager = PluginManager.getInstance();
        const commandLine = CommandLine.getInstance();
        const router = Router.getInstance();

        await router.stop();
        await pluginManager.shutdown();
        await commandLine.stop();
    }

    public static getInstance(): Application {
        if (Application.instance === undefined) {
            Application.instance = new Application();
        }
        return Application.instance;
    }

}