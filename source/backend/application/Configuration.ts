import { File } from "@lucania/toolbox/server";
import { Schema } from "@lucania/schema";
import { Path } from "./Path.js";
import { Configuration as ConfigurationDefinition } from "@lucania/seam.framework/shared";
import { Data } from "@lucania/toolbox/shared";

export class Configuration {

    private static instance: Configuration | undefined;

    private _raw: ConfigurationDefinition.Type | undefined;

    public async load() {
        const configurationString = await File.read(Path.File.Absolute.configuration, "utf8");
        const configurationData = JSON.parse(configurationString);
        this._raw = Schema.validate(ConfigurationDefinition.Schema, configurationData);
    }

    public get raw() {
        Data.assert(this._raw !== undefined, "Attempted to read configuration before it was loaded.");
        return this._raw;
    }

    public get loaded() {
        return this._raw !== undefined;
    }

    public static getInstance(): Configuration {
        if (Configuration.instance === undefined) {
            Configuration.instance = new Configuration();
        }
        return Configuration.instance;
    }

}