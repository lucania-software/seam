import { File } from "@lucania/toolbox/server";
import { Schema } from "@lucania/schema";
import { Path } from "./Path.js";
import { Configuration as ConfigurationDefinition } from "@lucania/seam.framework/shared";
import { ConsoleColor, Data } from "@lucania/toolbox/shared";
import { type FSWatcher, watch } from "chokidar";
import EventEmitter from "events";

export class Configuration extends EventEmitter {

    private static instance: Configuration | undefined;

    private _raw: ConfigurationDefinition.Type | undefined;

    private _watcher: FSWatcher;
    private _watcherReady: Promise<void>;

    private constructor() {
        super();
        this._watcher = watch(Path.File.Absolute.configuration);
        this._watcherReady = new Promise<void>(resolve => this._watcher.once("ready", resolve));

        this._watcher.on("change", async () => {
            const newRaw = await this._readRaw();
            const flatNewRaw = Data.flatten(newRaw);
            const flatRaw = Data.flatten(this._raw);
            const paths = new Set([...Object.keys(flatNewRaw), ...Object.keys(flatRaw)]);
            this._raw = newRaw;
            for (const path of paths) {
                if (flatNewRaw[path] !== flatRaw[path]) {
                    this.emit("change", path);
                }
            }
        });
    }

    public async load() {
        this._raw = await this._readRaw();
        await this._watcherReady;
    }

    public get raw() {
        Data.assert(this._raw !== undefined, "Attempted to read configuration before it was loaded.");
        return this._raw;
    }

    public get loaded() {
        return this._raw !== undefined;
    }

    private async _readRaw() {
        const { underscore, reset } = ConsoleColor.Common;
        Data.assert(
            await File.exists(Path.File.Absolute.configuration),
            "Your bundle is missing a configuration file. " +
            `A configuration file can be installed at "${underscore}${Path.File.Absolute.configuration}${reset}".`
        );
        const configurationString = await File.read(Path.File.Absolute.configuration, "utf8");
        const configurationData = JSON.parse(configurationString);
        return Schema.validate(ConfigurationDefinition.Schema, configurationData);
    }

    public static getInstance(): Configuration {
        if (Configuration.instance === undefined) {
            Configuration.instance = new Configuration();
        }
        return Configuration.instance;
    }

}