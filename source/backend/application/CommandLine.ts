import { Data, Error } from "@lucania/toolbox/shared";
import Readline from "readline";

export type CommandCallback = (...commandArguments: string[]) => void;
export type Command = { match: string | RegExp, callback: CommandCallback };

export class CommandLine {

    private static instance: CommandLine | undefined;

    private _interface: Readline.Interface | undefined;
    private _commands: Command[];

    private constructor() {
        this._commands = [];
    }

    public start() {
        this._interface = Readline.createInterface({ input: process.stdin });
        this._interface.addListener("line", async (input) => {
            const [commandInput, ...commandArguments] = input.split(/\s+/g);
            const command = this._getCommand(commandInput);
            if (command !== undefined) {
                try {
                    command.callback(...commandArguments);
                } catch (error) {
                    if (error instanceof Error.Assertion) {
                        console.error(error.message);
                    } else {
                        throw error;
                    }
                }
            }
        });
    }

    public async stop() {
        return new Promise<void>((resolve) => {
            Data.assert(this._interface !== undefined, "Attempted to stop command line before it was started.");
            this._interface.once("close", () => {
                process.stdin.destroy();
                resolve();
            });
            this._interface.close();
        });
    }

    public registerCommand(match: string | RegExp, callback: CommandCallback) {
        const command: Command = { match, callback };
        this._commands.push(command);
        return command;
    }

    public unregisterCommand(command: Command) {
        const index = this._commands.indexOf(command);
        if (index === -1) {
            return undefined;
        }
        const [unregisteredCommand] = this._commands.splice(index, 1);
        return unregisteredCommand;
    }

    public _getCommand(input: string) {
        return this._commands.find((command) => CommandLine._test(command, input));
    }

    private static _test(command: Command, input: string) {
        if (typeof command.match === "string") {
            return command.match === input;
        } else {
            return command.match.test(input);
        }
    }

    public static getInstance(): CommandLine {
        if (CommandLine.instance === undefined) {
            CommandLine.instance = new CommandLine();
        }
        return CommandLine.instance;
    }

}