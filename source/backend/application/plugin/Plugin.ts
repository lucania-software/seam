export class Plugin {

    public readonly name: string;
    public readonly specifier: string;
    public entryFilePath: string;

    public loadDefinition?: () => Promise<void> | void;
    public unloadDefinition?: () => Promise<void> | void;

    public constructor(name: string, specifier: string, entryFilePath: string) {
        this.name = name;
        this.specifier = specifier;
        this.entryFilePath = entryFilePath;
    }

}