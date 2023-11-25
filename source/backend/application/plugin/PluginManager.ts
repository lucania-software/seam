import { Schema } from "@lucania/schema";
import { Command, File } from "@lucania/toolbox/server";
import { ConsoleColor, Data, Error, Text } from "@lucania/toolbox/shared";
import { basename, join, posix, relative, resolve, sep } from "path";
import TypeScript from "typescript";
import { pathToFileURL } from "url";
import { Path } from "../Path.js";
import { Plugin } from "./Plugin.js";

type PackageJson = Schema.Model<typeof PluginManager.PACKAGE_JSON_SCHEMA>;

export class PluginManager {

    private static instance: PluginManager | undefined;

    private static readonly ON_LOAD_CALLBACK_NAME = "onLoad";
    private static readonly ON_UNLOAD_CALLBACK_NAME = "onUnload";
    private static readonly DEFAULT_PACKAGE_JSON = { name: "@lucania/seam.plugins", type: "module" };
    public static readonly PACKAGE_JSON_SCHEMA = Schema.build((type) => ({
        name: type.string.required(),
        main: type.string.optional(),
        exports: type.dynamic(type.logic.or(
            type.string,
            {
                node: type.string.optional(),
                default: type.string.optional()
            }
        )).optional(),
        dependencies: type.dynamic(type.string).optional()
    }));

    private readonly _map: Record<string, Plugin>;
    private _pluginExporter: any;
    private _cacheRefreshCounter: number;

    private constructor() {
        this._map = {};
        this._cacheRefreshCounter = 0;
    }

    public async load(plugin: Plugin | string) {
        plugin = typeof plugin === "string" ? this.getPluginSafe(plugin) : plugin;
        const { cyan, reset } = ConsoleColor.Common;
        console.info(`Loading plugin ${cyan}${plugin.name}${reset}.`);
        const exporterName = Text.camel(plugin.name);
        const pluginModule = this._pluginExporter[exporterName];
        Data.assert(pluginModule !== undefined, `Exporter missing export for plugin "${plugin.name}". (Using export "${exporterName}".)`);
        const loadDefinition = pluginModule[PluginManager.ON_LOAD_CALLBACK_NAME];
        if (typeof loadDefinition === "function") {
            plugin.loadDefinition = loadDefinition;
        }
        const unloadDefinition = pluginModule[PluginManager.ON_UNLOAD_CALLBACK_NAME];
        if (typeof unloadDefinition === "function") {
            plugin.unloadDefinition = unloadDefinition;
        }
        if (plugin.loadDefinition !== undefined) {
            await Promise.resolve(plugin.loadDefinition.call(plugin));
        }
    }

    public async unload(plugin: Plugin | string, unregister: boolean) {
        plugin = typeof plugin === "string" ? this.getPluginSafe(plugin) : plugin;
        const { cyan, reset } = ConsoleColor.Common;
        console.info(`Unloading plugin ${cyan}${plugin.name}${reset}.`);
        if (plugin.unloadDefinition !== undefined) {
            await Promise.resolve(plugin.unloadDefinition.call(plugin));
        }
        if (unregister) {
            delete this._map[plugin.name];
        }
    }

    public async reload(plugin: Plugin | string) {
        plugin = typeof plugin === "string" ? this.getPluginSafe(plugin) : plugin;

        const { cyan, reset } = ConsoleColor.Common;
        console.info(`Reloading plugin ${cyan}${plugin.name}${reset}.`);

        this._cacheRefreshCounter++;
        const packageJson = await this.getPluginPackageJson(plugin.name);
        plugin.entryFilePath = this.getPluginCachedEntryFilePath(plugin.name, packageJson);

        // await PluginManager._clearPluginModuleInstallation(plugin.name);
        // await PluginManager._installPlugins(plugin.specifier);

        await this._updatePluginCache(plugin.name);
        await this._updateExporter();

        await this.unload(plugin, false);
        await this.load(plugin);
    }

    public getPlugin(pluginName: string): Plugin | undefined {
        return this._map[pluginName];
    }

    public getPluginSafe(pluginName: string): Plugin {
        const plugin = this.getPlugin(pluginName);
        Data.assert(plugin !== undefined, `There is no plugin registered with the name "${pluginName}".`);
        return plugin;
    }

    public async setup(pluginSpecifiers: string[]) {
        await File.remove(Path.Directory.Absolute.Plugin.cache);
        await File.createDirectory(Path.Directory.Absolute.Plugin.cache);
        await File.write(Path.File.Absolute.Plugin.exporter, "", "utf8");

        const normalizedPluginSpecifiers = this._getNormalizedPluginSpecifiers(pluginSpecifiers);

        const pluginsToUpdateSpecifiers = [];
        for (const file of await File.listDirectory(Path.Directory.Absolute.plugins)) {
            if (basename(file).startsWith("cacheRefresh")) {
                try {
                    await File.remove(resolve(Path.Directory.Absolute.plugins, file));
                } catch (error) {
                    console.error(error);
                }
            }
        }
        if (await File.exists(Path.File.Absolute.Plugin.packageJson)) {
            for (const specifier of normalizedPluginSpecifiers) {
                const pluginName = this.getPluginName(specifier, await this.getPluginModulesProjectPackageJson());
                if (pluginName === undefined) {
                    pluginsToUpdateSpecifiers.push(specifier);
                } else if (this._isPluginUpdateRequired(pluginName)) {
                    pluginsToUpdateSpecifiers.push(specifier);
                }
            }
        } else {
            pluginsToUpdateSpecifiers.push(...normalizedPluginSpecifiers);
            await File.write(
                Path.File.Absolute.Plugin.packageJson,
                JSON.stringify(PluginManager.DEFAULT_PACKAGE_JSON, undefined, "    "),
                "utf8"
            );
        }

        await PluginManager._installPlugins(...pluginsToUpdateSpecifiers);
        await this._ensureFrameworkLinked();

        for (const pluginSpecifier of normalizedPluginSpecifiers) {
            const pluginName = this.getPluginName(pluginSpecifier, await this.getPluginModulesProjectPackageJson());
            if (pluginName === undefined) {
                console.warn(`Failed to load plugin specified by "${pluginSpecifier}".`);
            } else {
                const { green, reset } = ConsoleColor.Common;
                const pluginNewlyUpdated = pluginsToUpdateSpecifiers.includes(pluginSpecifier);
                if (pluginNewlyUpdated) {
                    console.info(`Installed new plugin "${green}${pluginName}${reset}"!`);
                } else {
                    console.info(`Plugin "${green}${pluginName}${reset}" is already installed and up to date.`);
                }
                const pluginPackageJson = await this.getPluginPackageJson(pluginName);
                Data.assert(
                    !pluginPackageJson.main !== undefined && !pluginPackageJson.exports !== undefined,
                    `Plugin "${pluginName}" does not have a main entry point.`
                );
                const plugin = new Plugin(pluginName, pluginSpecifier, this.getPluginCachedEntryFilePath(pluginName, pluginPackageJson));
                this._map[pluginName] = plugin;

                await this._updatePluginCache(pluginName);
            }
        }
        await this._updateExporter();
    }

    /**
     * Writes a copy of a plugin's npm module into a unique location to bust node's import cache.
     * @param pluginName The name of the plugin to update the cache of.
     */
    private async _updatePluginCache(pluginName: string) {
        const fromPath = this.getPluginInstalledRootDirectory(pluginName);
        const toPath = this.getPluginCachedRootDirectory(pluginName);
        await PluginManager._copyToCache(fromPath, toPath);
    }

    private static async _copyToCache(fromPath: string, toPath: string) {
        const meta = await File.getMeta(fromPath);
        if (meta.directory) {
            if (basename(fromPath) !== Path.Directory.nodeModules) {
                const copyTasks: Promise<void>[] = [];
                const fileList = await File.listDirectory(fromPath);
                for (const file of fileList) {
                    copyTasks.push(PluginManager._copyToCache(join(fromPath, file), join(toPath, file)));
                }
                await Promise.all(copyTasks);
            }
        } else {
            await File.copy(fromPath, toPath);
        }
    }

    public async shutdown() {
        await File.remove(Path.Directory.Absolute.Plugin.cache);
    }

    private async _ensureFrameworkLinked() {
        const packageJson = await this.getProjectPackageJson();
        if (!await File.exists(join(Path.Directory.Absolute.Plugin.nodeModules, packageJson.name))) {
            console.debug(`Linking plugins with framework... (${packageJson.name})`);
            await Command.execute(
                `npm install --save ${Path.Directory.Absolute.root}`,
                { currentWorkingDirectory: Path.Directory.Absolute.plugins }
            );
        }
    }

    private static async _installPlugins(...pluginSpecifiers: string[]) {
        if (pluginSpecifiers.length > 0) {
            const flags = [
                "--no-progress",
                "--no-audit",
                "--omit=dev"
            ];
            const installCommand = `npm install ${pluginSpecifiers.join(" ")} ${flags.join(" ")}`;
            const { gray, reset } = ConsoleColor.Common;
            console.debug(`${gray}Installing plugin modules...\n  ${installCommand}${reset}`);
            await Command.execute(installCommand, { currentWorkingDirectory: Path.Directory.Absolute.plugins });
        }
    }

    private static async _clearPluginModuleInstallation(pluginName: string) {
        const pluginInstallDirectory = join(Path.Directory.Absolute.Plugin.nodeModules, pluginName);
        if (await File.exists(pluginInstallDirectory)) {
            const { gray, reset } = ConsoleColor.Common;
            console.debug(`${gray}Clearing outdated plugin module installation for "${pluginName}".${reset}`);
            await File.remove(pluginInstallDirectory);
        }
    }

    public async loadAll() {
        for (const plugin of Object.values(this._map)) {
            await this.load(plugin);
        }
    }

    public async unloadAll(unregister: boolean) {
        for (const plugin of Object.values(this._map).reverse()) {
            await this.unload(plugin, unregister);
        }
    }

    public getPluginName(specifier: string, packageJson: PackageJson): string | undefined {
        if (packageJson.dependencies !== undefined) {
            for (const pluginName in packageJson.dependencies) {
                const dependencySpecifier = packageJson.dependencies[pluginName];
                if (specifier === dependencySpecifier) {
                    return pluginName;
                }
            }
        }
        return undefined;
    }

    private _isPluginUpdateRequired(pluginName: string) {
        return false;
    }

    /**
     * Updates exporter file at {@link Path.File.Absolute.Plugin.exporter} to allow exports from newly cached plugins.
     */
    private async _updateExporter() {
        const statements: TypeScript.Statement[] = [];
        for (const pluginName in this._map) {
            const plugin = this.getPluginSafe(pluginName);
            statements.push(
                TypeScript.factory.createExportDeclaration(
                    undefined,
                    false,
                    TypeScript.factory.createNamespaceExport(TypeScript.factory.createIdentifier(Text.camel(plugin.name))),
                    TypeScript.factory.createStringLiteral(pathToFileURL(plugin.entryFilePath).href)
                )
            );
        }
        const sourceFile = TypeScript.factory.createSourceFile(
            statements,
            TypeScript.factory.createToken(TypeScript.SyntaxKind.EndOfFileToken),
            TypeScript.NodeFlags.JavaScriptFile
        );
        const printer = TypeScript.createPrinter();
        await File.write(Path.File.Absolute.Plugin.exporter, printer.printFile(sourceFile), "utf8");
        this._pluginExporter = await import(PluginManager.addCacheBuster(pathToFileURL(Path.File.Absolute.Plugin.exporter).href));
    }

    private _getNormalizedPluginSpecifiers(pluginSpecifiers: string[]) {
        const normalizedPluginSpecifiers: string[] = [];
        const fileSpecifierPrefix = "file:";
        for (const pluginSpecifier of pluginSpecifiers) {
            if (pluginSpecifier.startsWith(fileSpecifierPrefix)) {
                const filePath = resolve(pluginSpecifier.substring(fileSpecifierPrefix.length));
                const relativeFilePath = relative(Path.Directory.Absolute.plugins, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(sep));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else if (pluginSpecifier.startsWith(".")) {
                const filePath = resolve(Path.Directory.Absolute.root, pluginSpecifier);
                const relativeFilePath = relative(Path.Directory.Absolute.plugins, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(sep));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else {
                normalizedPluginSpecifiers.push(pluginSpecifier);
            }
        }
        return normalizedPluginSpecifiers;
    }

    public async getProjectPackageJson() {
        const packageJsonString = await File.read(Path.File.Absolute.packageJson, "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return Schema.validate(PluginManager.PACKAGE_JSON_SCHEMA, packageJsonData);
    }

    public async getPluginModulesProjectPackageJson() {
        const packageJsonString = await File.read(Path.File.Absolute.Plugin.packageJson, "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return Schema.validate(PluginManager.PACKAGE_JSON_SCHEMA, packageJsonData);
    }

    public async getPluginPackageJson(pluginName: string) {
        const packageJsonPath = join(this.getPluginInstalledRootDirectory(pluginName), Path.File.packageJson);
        const packageJsonString = await File.read(packageJsonPath, "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return Schema.validate(PluginManager.PACKAGE_JSON_SCHEMA, packageJsonData);
    }

    public getPluginInstalledRootDirectory(pluginName: string) {
        return join(Path.Directory.Absolute.plugins, Path.Directory.nodeModules, pluginName);
    }

    public getPluginCachedRootDirectory(pluginName: string) {
        return join(Path.Directory.Absolute.Plugin.cache, pluginName, this._cacheRefreshCounter.toString());
    }

    public getPluginCachedEntryFilePath(pluginName: string, packageJson: PackageJson) {
        let relativeEntryFilePath;
        if (packageJson.main !== undefined) {
            relativeEntryFilePath = packageJson.main;
        } else if (packageJson.exports !== undefined) {
            const entrySubpathExport = "./entry";
            const entry = packageJson.exports[entrySubpathExport];
            Data.assert(entry !== undefined, `Plugin "${pluginName}" does not have an "${entrySubpathExport}" subpath export.`);
            if (typeof entry === "string") {
                relativeEntryFilePath = entry;
            } else {
                if (entry.default !== undefined) {
                    relativeEntryFilePath = entry.default;
                } else if (entry.node !== undefined) {
                    relativeEntryFilePath = entry.node;
                } else {
                    throw new Error.Assertion(`Plugin "${pluginName}" does not have an "${entrySubpathExport}" "default" or "node" subpath export.`);
                }
            }
        } else {
            throw new Error.Assertion(`Plugin "${pluginName}" does not define an entry point.`);
        }
        return join(this.getPluginCachedRootDirectory(pluginName), relativeEntryFilePath);
    }

    public static addCacheBuster(fileUrl: string) {
        return `${fileUrl}?cacheBuster=${Date.now()}`;
    }

    public static getInstance(): PluginManager {
        if (PluginManager.instance === undefined) {
            PluginManager.instance = new PluginManager();
        }
        return PluginManager.instance;
    }

}
