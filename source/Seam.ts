import { Schema } from "@lucania/schema";
import { Command, File } from "@lucania/toolbox/server";
import { ConsoleColor, Data } from "@lucania/toolbox/shared";
import { join, posix, relative, resolve, sep as separator } from "path";
import { pathToFileURL } from "url";
import { PackageJson } from "./schema/PackageJson.js";

type RegisteredPlugin = {
    loadDefinition?: () => Promise<void> | void;
    unloadDefinition?: () => Promise<void> | void;
};

export type SeamOptions = {
    rootDirectory: string,
    cacheBust?: boolean
};

export class Seam {

    private static readonly CACHE_DIRECTORY = "cache";
    private static readonly INSTALLATION_DIRECTORY = "installation";
    private static readonly PACKAGE_JSON_FILE = "package.json";
    private static readonly NODE_MODULES_DIRECTORY = "node_modules";

    private static readonly ON_LOAD_CALLBACK_NAME = "onLoad";
    private static readonly ON_UNLOAD_CALLBACK_NAME = "onUnload";

    private _rootDirectory: string;
    private _pluginsInstallationDirectory: string;
    private _pluginsInstallationPackageJson: string;
    private _pluginsInstallationNodeModulesDirectory: string;
    private _pluginsCacheDirectory?: string;

    private readonly _pluginRegister: Record</* Plugin Name */ string, RegisteredPlugin>;
    private readonly _specifierMap: Record</* Plugin Specifier */ string, /* Plugin Name */ string>;
    private readonly _loaded: Set</* Plugin Name */ string>;
    private readonly _reloading: Set</* Plugin Name */ string>;

    private _cacheNumber: number;

    private _installationFlags: string[]

    public constructor(options: SeamOptions) {
        this._rootDirectory = resolve(options.rootDirectory);

        this._pluginsInstallationDirectory = join(this._rootDirectory, Seam.INSTALLATION_DIRECTORY);
        this._pluginsInstallationPackageJson = join(this._pluginsInstallationDirectory, Seam.PACKAGE_JSON_FILE);
        this._pluginsInstallationNodeModulesDirectory = join(this._pluginsInstallationDirectory, Seam.NODE_MODULES_DIRECTORY);

        this._pluginsCacheDirectory = options.cacheBust === true ? join(this._rootDirectory, Seam.CACHE_DIRECTORY) : undefined;

        this._pluginRegister = {};
        this._specifierMap = {};
        this._loaded = new Set();
        this._reloading = new Set();

        this._cacheNumber = 0;

        this._installationFlags = [
            "--no-progress",
            "--no-audit",
            "--save",
            "--package-lock=false",
            "--omit=dev",
            // TO-DO
            // Can't use because it breaks relative file dependencies
            // Have to use, otherwise symlinks all resolve to same filepath, no busting cache. 
            "--install-links"
        ];
    }

    public async loadPlugins(...names: string[]) {
        for (const name of names) {
            Data.assert(this.isPluginRegistered(name), `${name} is not a registered plugin!`);
            Data.assert(!this.isPluginLoaded(name), `${name} is already loaded!`);
            const registeredPlugin = this._pluginRegister[name];
            if (registeredPlugin.loadDefinition !== undefined) {
                await Promise.resolve(registeredPlugin.loadDefinition.call(name));
            }
            this._loaded.add(name);
        }
    }

    public async unloadPlugin(name: string) {
        Data.assert(this.isPluginRegistered(name), `${name} is not a registered plugin!`);
        Data.assert(this.isPluginLoaded(name), `${name} is not loaded!`);
        const registeredPlugin = this._pluginRegister[name];
        if (registeredPlugin.unloadDefinition !== undefined) {
            await Promise.resolve(registeredPlugin.unloadDefinition.call(name));
        }
        this._loaded.delete(name);
    }

    public async unloadPlugins(...names: string[]) {
        await Promise.all(names.map(name => this.unloadPlugin(name)));
    }

    public async reloadPlugin(name: string, reinstall: boolean = true) {
        try {
            this._reloading.add(name);
            if (reinstall) {
                if (await this.isPluginInstalled(name)) {
                    await this.uninstallPlugin(name);
                }
                await this.installPlugins(name);
                await this.registerPlugins(name);
                await this.loadPlugins(name);
            } else {
                if (this.isPluginLoaded(name)) {
                    await this.unloadPlugin(name);
                }
                await this.loadPlugins(name);
            }
        } finally {
            this._reloading.delete(name);
        }
    }

    public async registerPlugins(...names: string[]) {
        for (const name of names) {
            let resolution;
            const parent = this._getUsagePackageJson();
            try {
                resolution = import.meta.resolve(name, pathToFileURL(parent));
            } catch (error) {
                Data.assert(error instanceof Error, "Threw an error that wasn't of Error type.");
                console.error(`Failed to resolve plugin "${name}" relative to "${parent}". ${error.message}`);
                if (!process.execArgv.includes("--experimental-import-meta-resolve")) {
                    console.error(`Seam currently requires the "--experimental-import-meta-resolve" the flag to be present to resolve plugins correctly.`);
                }
            }
            if (resolution !== undefined) {
                console.log("Executing registration", resolution);
                const module = await import(resolution);
                let loadDefinition = module[Seam.ON_LOAD_CALLBACK_NAME];
                let unloadDefinition = module[Seam.ON_UNLOAD_CALLBACK_NAME];
                if (typeof loadDefinition !== "function") {
                    loadDefinition = undefined;
                }
                if (typeof unloadDefinition !== "function") {
                    unloadDefinition = undefined;
                }
                const { yellow, reset } = ConsoleColor.Common;
                if (loadDefinition === undefined && unloadDefinition === undefined) {
                    console.warn(`${yellow}${name}${reset} does not export a ${Seam.ON_LOAD_CALLBACK_NAME} or ${Seam.ON_UNLOAD_CALLBACK_NAME} function.`);
                } else if (loadDefinition === undefined) {
                    console.warn(`${yellow}${name}${reset} does not export a ${Seam.ON_LOAD_CALLBACK_NAME} function.`);
                } else if (unloadDefinition === undefined) {
                    console.warn(`${yellow}${name}${reset} does not export a ${Seam.ON_UNLOAD_CALLBACK_NAME} function.`);
                }
                this._pluginRegister[name] = { loadDefinition, unloadDefinition };
            }
        }
    }

    public async unregisterPlugin(name: string) {
        if (this.isPluginLoaded(name)) {
            await this.unloadPlugin(name);
        }
        delete this._pluginRegister[name];
    }

    public async unregisterPlugins(...names: string[]) {
        await Promise.all(names.map(name => this.unregisterPlugin(name)));
    }

    /**
     * Installs a list of plugin specifiers to the internal plugin store.
     * 
     * @param specifiers An array of NPM specifiers for plugins to install.
     */
    public async installPlugins(...specifiers: string[]) {
        let packageJson: PackageJson.Type;
        if (await this._isPackageJsonExistent()) {
            packageJson = await this._readPackageJson();
        } else {
            packageJson = await this._generatePackageJson();
        }
        specifiers = await this._getNormalizedPluginSpecifiers(specifiers);
        try {
            await Command.execute(
                `npm install ${specifiers.join(" ")} ${this._installationFlags.join(" ")}`,
                { currentWorkingDirectory: this._pluginsInstallationDirectory }
            );
            await this._unpackSymlinks();
            packageJson = await this._readPackageJson();

            if (this._pluginsCacheDirectory !== undefined) {
                this._cacheNumber++;
                if (this._cacheNumber > 1) {
                    await File.copy(this._pluginsInstallationDirectory, this._getUsageDirectory());
                    await this._resolveRelativeFileDependencies(this._getUsagePackageJson(), this._pluginsInstallationDirectory);
                }
            }
        } catch (error) {
            if (error instanceof Error) {
                let formattedErrorMessage = error.message;
                formattedErrorMessage = formattedErrorMessage.replaceAll(/^/gm, "\t");
                formattedErrorMessage = formattedErrorMessage.replaceAll(/npm ERR! /gm, "");
                const { gray, reset } = ConsoleColor.Common;
                console.error(
                    `NPM failed to install plugins.\n` +
                    `\t${gray}Root: ${this._pluginsInstallationDirectory}\n` +
                    `${formattedErrorMessage}${reset}`
                );
            }
            return new Array(specifiers.length).fill(undefined);
        }
        return specifiers.map((specifier) => {
            const pluginName = this._findPluginName(specifier, packageJson);
            if (pluginName === undefined) {
                const { yellow, reset } = ConsoleColor.Common;
                console.warn(`Failed to find name of plugin specified by "${yellow}${specifier}${reset}".`);
                console.warn("Checking", packageJson);
            }
            return pluginName;
        });
    }

    public async _resolveRelativeFileDependencies(packageJsonPath: string, relativeTo: string) {
        console.log(packageJsonPath, relativeTo);
    }

    /**
     * Uninstalls a plugin from the internal plugin store.
     * @param name The name of the plugin to uninstall.
     */
    public async uninstallPlugin(name: string) {
        Data.assert(await this.isPluginInstalled(name), `${name} is not an installed plugin.`);
        await this.unregisterPlugin(name);
        await File.remove(this._getPluginInstallationModuleDirectory(name));
    }

    public async uninstallPlugins(...names: string[]) {
        await Promise.all(names.map((name) => this.uninstallPlugin(name)));
    }

    public async uninstallAllPlugins() {
        for (const name of this.getRegisteredPlugins()) {
            this.unregisterPlugin(name);
        }
        const tasks = [];
        if (this._pluginsCacheDirectory) {
            tasks.push(File.remove(this._pluginsCacheDirectory));
        }
        tasks.push(File.remove(this._pluginsInstallationDirectory));
        await Promise.all(tasks);
    }

    public isPluginLoaded(name: string) {
        return this._loaded.has(name);
    }

    public isPluginRegistered(name: string) {
        return name in this._pluginRegister;
    }

    public async isPluginInstalled(name: string) {
        return await File.exists(this._getPluginInstallationModuleDirectory(name));
    }

    public getLoadedPlugins() {
        return [...this._loaded];
    }

    public getRegisteredPlugins() {
        return Object.keys(this._pluginRegister);
    }

    private async _getNormalizedPluginSpecifiers(pluginSpecifiers: string[]) {
        const normalizedPluginSpecifiers: string[] = [];
        const fileSpecifierPrefix = "file:";
        for (const pluginSpecifier of pluginSpecifiers) {
            if (pluginSpecifier.startsWith(fileSpecifierPrefix)) {
                const filePath = resolve(pluginSpecifier.substring(fileSpecifierPrefix.length));
                const relativeFilePath = relative(this._pluginsInstallationDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else if (pluginSpecifier.startsWith(".")) {
                const filePath = resolve(pluginSpecifier);
                const relativeFilePath = relative(this._pluginsInstallationDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else if (await File.exists(pluginSpecifier)) {
                const filePath = resolve(pluginSpecifier);
                const relativeFilePath = relative(this._pluginsInstallationDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else {
                normalizedPluginSpecifiers.push(pluginSpecifier);
            }
        }
        return normalizedPluginSpecifiers;
    }

    private _getUsageDirectory() {
        if (this._pluginsCacheDirectory === undefined || this._cacheNumber <= 1) {
            return this._pluginsInstallationDirectory;
        } else {
            return join(this._pluginsCacheDirectory, this._cacheNumber.toString());
        }
    }

    private _getUsagePackageJson() {
        return join(this._getUsageDirectory(), Seam.PACKAGE_JSON_FILE);
    }

    private _getUsageNodeModulesDirectory() {
        return join(this._getUsageDirectory(), Seam.NODE_MODULES_DIRECTORY);
    }

    private async _isPackageJsonExistent() {
        return await File.exists(this._pluginsInstallationPackageJson);
    }

    private async _generatePackageJson() {
        const packageJson = Schema.validate(PackageJson.Schema, { type: "module", name: "@lucania/seam.plugins" });
        await File.write(this._pluginsInstallationPackageJson, JSON.stringify(packageJson, undefined, "    "), "utf8");
        return packageJson;
    }

    private async _unpackSymlinks(filePath: string = this._pluginsInstallationDirectory) {
        const fileMeta = await File.getMeta(filePath);
        if (fileMeta.directory) {
            const files = await File.listDirectory(filePath);
        } else if (fileMeta.symlink) {

        } else {

        }
    }

    private async _readPackageJson() {
        const packageJsonString = await File.read(this._pluginsInstallationPackageJson, "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return Schema.validate(PackageJson.Schema, packageJsonData);
    }

    private _getPluginInstallationModuleDirectory(name: string) {
        return join(this._pluginsInstallationNodeModulesDirectory, name);
    }

    private _getPluginUsageModuleDirectory(name: string) {
        return join(this._getUsageNodeModulesDirectory(), name);
    }

    private _findPluginName(specifier: string, packageJson: PackageJson.Type): string | undefined {
        if (specifier in this._specifierMap) {
            return this._specifierMap[specifier];
        }
        if (packageJson.dependencies !== undefined) {
            for (const pluginName in packageJson.dependencies) {
                const dependencySpecifier = packageJson.dependencies[pluginName];
                if (specifier === dependencySpecifier) {
                    this._specifierMap[specifier] = pluginName;
                    this._specifierMap[pluginName] = pluginName;
                    return pluginName;
                }
            }
        }
        return undefined;
    }

}
