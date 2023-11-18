import { Data } from "@lucania/toolbox/shared";
import { CommandLine } from "./CommandLine.js";
import { Configuration } from "./Configuration.js";
import { PluginManager } from "./plugin/PluginManager.js";
import { Router } from "./web/Router.js";
import { CatchAllHandler } from "./web/handlers/CatchAll.js";

export class Application {

    private static instance: Application | undefined;

    public async start() {
        const configuration = Configuration.getInstance();
        const commandLine = CommandLine.getInstance();
        const pluginManager = PluginManager.getInstance();
        const router = Router.getInstance();

        commandLine.registerCommand("stop", () => this.stop());
        commandLine.registerCommand("reload", (pluginName) => {
            Data.assert(pluginName !== undefined, "Please specify the name of the plugin you wish to reload.");
            const plugin = pluginManager.getPlugin(pluginName);
            Data.assert(plugin !== undefined, `There are no plugins registered with the name "${pluginName}".`);
            pluginManager.reload(plugin);
        });
        commandLine.registerCommand("test", async () => {
            await pluginManager.reload("@lucania/seam.plugin.essentials");
        });

        router.registerHandler(new CatchAllHandler());

        await configuration.load();
        commandLine.start();

        await pluginManager.setup();
        await pluginManager.loadAll();

        console.info(`Started web server running at ${configuration.raw.web.host}:${configuration.raw.web.port}.`);
        await router.start(configuration.raw.web.port, configuration.raw.web.host);
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