import { Schema } from "@lucania/schema";
import { Command, File } from "@lucania/toolbox/server";
import { ConsoleColor, Data } from "@lucania/toolbox/shared";
import { join, posix, relative, resolve, sep as separator } from "path";
import { pathToFileURL } from "url";
import { PackageJson } from "./schema/PackageJson.js";

type RegisteredPlugin<LoadResult = any, UnloadResult = any> = {
    package: PackageJson.Type,
    loadDefinition?: (this: PackageJson.Type) => Promise<LoadResult> | LoadResult;
    unloadDefinition?: (this: PackageJson.Type) => Promise<UnloadResult> | UnloadResult;
};

type LoadResults<LoadResult = any> = Record<string, LoadResult>;

export type SeamOptions = {
    rootDirectory: string
};

export class Seam {

    private static readonly PACKAGE_JSON_FILE = "package.json";
    private static readonly NODE_MODULES_DIRECTORY = "node_modules";

    private static readonly ON_LOAD_CALLBACK_NAME = "onLoad";
    private static readonly ON_UNLOAD_CALLBACK_NAME = "onUnload";

    private _rootDirectory: string;
    private _pluginsInstallationNodeModulesDirectory: string;

    private readonly _pluginRegister: Record</* Plugin Name */ string, RegisteredPlugin>;
    private readonly _specifierMap: Record</* Plugin Specifier */ string, /* Plugin Name */ string>;
    private readonly _loaded: Set</* Plugin Name */ string>;
    private readonly _reloading: Set</* Plugin Name */ string>;

    private _installationFlags: string[]

    public constructor(options: SeamOptions) {
        this._rootDirectory = resolve(options.rootDirectory);

        this._pluginsInstallationNodeModulesDirectory = join(this._rootDirectory, Seam.NODE_MODULES_DIRECTORY);

        this._pluginRegister = {};
        this._specifierMap = {};
        this._loaded = new Set();
        this._reloading = new Set();

        this._installationFlags = [
            "--no-progress",
            "--no-audit",
            "--save",
            "--package-lock=false",
            "--omit=dev"
        ];
    }

    public async loadPlugins(...names: string[]): Promise<LoadResults> {
        const loadResults: LoadResults = {};
        for (const name of names) {
            Data.assert(this.isPluginRegistered(name), `${name} is not a registered plugin!`);
            Data.assert(!this.isPluginLoaded(name), `${name} is already loaded!`);
            const registeredPlugin = this._pluginRegister[name];
            if (registeredPlugin.loadDefinition !== undefined) {
                loadResults[name] = await Promise.resolve(registeredPlugin.loadDefinition.call(registeredPlugin.package));
            }
            this._loaded.add(name);
        }
        return loadResults;
    }

    public async unloadPlugin(name: string) {
        Data.assert(this.isPluginRegistered(name), `${name} is not a registered plugin!`);
        Data.assert(this.isPluginLoaded(name), `${name} is not loaded!`);
        const registeredPlugin = this._pluginRegister[name];
        if (registeredPlugin.unloadDefinition !== undefined) {
            await Promise.resolve(registeredPlugin.unloadDefinition.call(registeredPlugin.package));
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
            const parent = this.getPackageJsonPath();
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
                const module = await import(resolution);
                const packageJson = await this.getPluginPackageJson(name);
                let loadDefinition = module[Seam.ON_LOAD_CALLBACK_NAME];
                let unloadDefinition = module[Seam.ON_UNLOAD_CALLBACK_NAME];
                if (typeof loadDefinition !== "function") {
                    loadDefinition = undefined;
                }
                if (typeof unloadDefinition !== "function") {
                    unloadDefinition = undefined;
                }
                const { yellow, reset } = ConsoleColor.Common;
                if (loadDefinition === undefined) {
                    console.warn(`${yellow}${name}${reset} does not export a ${Seam.ON_LOAD_CALLBACK_NAME} function.`);
                }
                this._pluginRegister[name] = { loadDefinition, unloadDefinition, package: packageJson };
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
        if (await this.isPackageJsonExistent()) {
            packageJson = await this.getPackageJson();
        } else {
            packageJson = await this._generatePackageJson();
        }
        specifiers = await this._getNormalizedPluginSpecifiers(specifiers);
        try {
            await Command.execute(
                `npm install ${specifiers.join(" ")} ${this._installationFlags.join(" ")}`,
                { currentWorkingDirectory: this._rootDirectory }
            );
            packageJson = await this.getPackageJson();
        } catch (error) {
            if (error instanceof Error) {
                let formattedErrorMessage = error.message;
                formattedErrorMessage = formattedErrorMessage.replaceAll(/^/gm, "\t");
                formattedErrorMessage = formattedErrorMessage.replaceAll(/npm ERR! /gm, "");
                const { gray, reset } = ConsoleColor.Common;
                console.error(
                    `NPM failed to install plugins.\n` +
                    `\t${gray}Root: ${this._rootDirectory}\n` +
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
        await File.remove(this.getPluginInstallationModuleDirectory(name));
    }

    public async uninstallPlugins(...names: string[]) {
        await Promise.all(names.map((name) => this.uninstallPlugin(name)));
    }

    public async uninstallAllPlugins() {
        for (const name of this.getRegisteredPlugins()) {
            this.unregisterPlugin(name);
        }
        await File.remove(this._rootDirectory);
    }

    public isPluginLoaded(name: string) {
        return this._loaded.has(name);
    }

    public isPluginRegistered(name: string) {
        return name in this._pluginRegister;
    }

    public async isPluginInstalled(name: string) {
        return await File.exists(this.getPluginInstallationModuleDirectory(name));
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
                const relativeFilePath = relative(this._rootDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else if (pluginSpecifier.startsWith(".")) {
                const filePath = resolve(pluginSpecifier);
                const relativeFilePath = relative(this._rootDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else if (await File.exists(pluginSpecifier)) {
                const filePath = resolve(pluginSpecifier);
                const relativeFilePath = relative(this._rootDirectory, filePath);
                const npmRelativeFilePath = posix.join(...relativeFilePath.split(separator));
                normalizedPluginSpecifiers.push(fileSpecifierPrefix + npmRelativeFilePath);
            } else {
                normalizedPluginSpecifiers.push(pluginSpecifier);
            }
        }
        return normalizedPluginSpecifiers;
    }

    public getPluginInstallationDirectory(name: string) {
        return join(this.getNodeModulesDirectory(), name);
    }

    public getPluginPackageJsonPath(name: string) {
        return join(this.getPluginInstallationDirectory(name), Seam.PACKAGE_JSON_FILE);
    }

    public async getPluginPackageJson(name: string) {
        const packageJsonString = await File.read(this.getPluginPackageJsonPath(name), "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return PackageJson.Schema.validate(packageJsonData);
    }

    public getPackageJsonPath() {
        return join(this._rootDirectory, Seam.PACKAGE_JSON_FILE);
    }

    public async getPackageJson() {
        const packageJsonString = await File.read(this.getPackageJsonPath(), "utf8");
        const packageJsonData = JSON.parse(packageJsonString);
        return PackageJson.Schema.validate(packageJsonData);
    }

    public getNodeModulesDirectory() {
        return join(this._rootDirectory, Seam.NODE_MODULES_DIRECTORY);
    }

    public async isPackageJsonExistent() {
        return await File.exists(this.getPackageJsonPath());
    }

    public getPluginInstallationModuleDirectory(name: string) {
        return join(this._pluginsInstallationNodeModulesDirectory, name);
    }

    private async _generatePackageJson() {
        const packageJson = PackageJson.Schema.validate({ type: "module", name: "seam.plugins" });
        await File.write(this.getPackageJsonPath(), JSON.stringify(packageJson, undefined, "    "), "utf8");
        return packageJson;
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
