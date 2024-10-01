import { ImportDeclaration, Node, parse, Program } from "acorn";
import { simple } from "acorn-walk";
import { File } from "@lucania/toolbox/server";
import { Data, Text } from "@lucania/toolbox/shared";
import { watch } from "chokidar";
import { generate } from "escodegen";
import Url from "node:url";
import Path from "node:path";
import FileSystem from "node:fs";

// const sourceCode = await File.read(path, "utf8");

// const program = parse(sourceCode, { ecmaVersion: "latest", sourceType: "module" });

// simple(program, {
//     ImportDeclaration(node) {
//         console.log(node);
//     }
// });

// { File: Importer }
type DependencyMap = Record<string, {
    program?: Program,
    dependants: { path: string, node: ImportDeclaration }[]
}>;

type DependantMap = Record<string, { path: string, declaration: ImportDeclaration }[]>;

type ProgramMap = Record<string, Program>;

type ParsedFile = {
    path: string,
    program: Program,
};

type Execution = {
    load: Function,
    unload?: Function
};

function getFile(path: string): ParsedFile {
    path = Path.resolve(path);
    const sourceCode = FileSystem.readFileSync(path, "utf8");
    const program = parse(sourceCode, { ecmaVersion: "latest", sourceType: "module" });
    return { path, program };
}

function getAllFiles(entryPointPath: string): ParsedFile[] {
    const { path, program } = getFile(entryPointPath);
    const directory = Path.dirname(path);
    const files = [{ path, program }];
    simple(program, {
        ImportDeclaration(node) {
            if (typeof node.source.value === "string") {
                files.push(...getAllFiles(Path.resolve(directory, node.source.value)))
            }
        }
    });
    return files;
}

function getProgramMap(files: ParsedFile[]): ProgramMap {
    const map: ProgramMap = {};
    for (const file of files) {
        map[file.path] = file.program;
    }
    return map;
}

function getDependantMap(files: ParsedFile[]): DependantMap {
    const map: DependantMap = {};
    for (const file of files) {
        const directory = Path.dirname(file.path);
        simple(file.program, {
            ImportDeclaration(node) {
                if (typeof node.source.value === "string") {
                    const path = Path.resolve(directory, node.source.value);
                    if (!(path in map)) {
                        map[path] = [];
                    }
                    map[path].push({ path: file.path, declaration: node });
                }
            }
        });
    }
    return map;
}

// function getDependencyMap(modulePath: string) {
//     const resolvedModulePath = Path.resolve(modulePath);
//     const sourceCode = FileSystem.readFileSync(resolvedModulePath, "utf8");
//     const program = parse(sourceCode, { ecmaVersion: "latest", sourceType: "module" });
//     const directory = Path.dirname(modulePath);
//     const map: DependencyMap = {};

//     Data.assert(!(modulePath in map), `Already traversed ${modulePath}.`);
//     map[modulePath] = { program, dependants: [] };

//     simple(program, {
//         ImportDeclaration(node) {
//             if (typeof node.source.value === "string") {
//                 const path = Path.resolve(directory, node.source.value);
//                 const subDependencyMap = getDependencyMap(path);
//                 for (const subDependencyPath in subDependencyMap) {
//                     map[subDependencyPath].dependants.push(...subDependencyMap[subDependencyPath].dependants);
//                 }
//                 Data.assert(path in map, `Haven't yet traversed ${path}`);
//                 map[path].dependants.push({ path: modulePath, node });
//             }
//         }
//     });

//     return map;
// }

function getRandomCacheBuster() {
    return Math.random().toFixed(6).slice(2);
};

function cacheBustSpecifier(specifier: string) {
    return `${specifier}?cacheBuster=${getRandomCacheBuster()}`;
}

function cacheBust(filePath: string, programMap: ProgramMap, dependantMap: DependantMap, cacheBuster: string = getRandomCacheBuster()) {
    if (filePath in dependantMap && dependantMap[filePath].length > 0) {
        for (const dependant of dependantMap[filePath]) {
            if (dependant.declaration.source.raw !== undefined) {
                const specifier = Text.unquote(Text.unquote(dependant.declaration.source.raw), "'");
                dependant.declaration.source.value = cacheBustSpecifier(specifier);
                console.log(`Cache busting import "${specifier}" in "${dependant.path}"`);
                FileSystem.writeFileSync(dependant.path, generate(programMap[dependant.path]), "utf8");
            }
            cacheBust(dependant.path, programMap, dependantMap, cacheBuster);
        }
        Data.assert(filePath in programMap, `Couldn't find program for "${filePath}".`);
    }
}

async function execute(path: string, previousExecution?: Execution): Promise<Execution> {
    if (previousExecution !== undefined) {
        if (previousExecution.unload !== undefined) {
            previousExecution.unload();
        }
    }
    const module = await import(cacheBustSpecifier(Url.pathToFileURL(path).href));
    const { load, unload } = module;
    Data.assert(typeof load === "function", `Unable to import "load" function.`);
    Data.assert(typeof unload === "function" || typeof unload === "undefined", `Unable to import "unload" function.`);
    load();
    return { load, unload };
}

function getCacheBustedDirectory(rootDirectory: string) {
    return Path.resolve(rootDirectory, ".cacheBusted");
}

function getCacheBustedFilePath(rootDirectory: string, sourceFilePath: string) {
    return Path.resolve(getCacheBustedDirectory(rootDirectory), Path.relative(rootDirectory, sourceFilePath));
}

async function startExecution(modulePath: string) {
    modulePath = Path.resolve(modulePath);
    const rootDirectory = Path.dirname(modulePath);
    const cacheBustedModulePath = getCacheBustedFilePath(rootDirectory, modulePath);
    await File.copy(rootDirectory, getCacheBustedDirectory(rootDirectory));

    const sourceFiles = getAllFiles(modulePath);
    const cacheBustedFiles = getAllFiles(cacheBustedModulePath);
    const programMap = getProgramMap(cacheBustedFiles);
    const dependantMap = getDependantMap(cacheBustedFiles);
    let execution = await execute(cacheBustedModulePath);

    for (const sourceFile of sourceFiles) {
        const watcher = watch(sourceFile.path);
        watcher.on("all", (eventName: string, sourceFilePath: string) => {
            console.log(eventName);
            if (eventName === "change") {
                const cacheBustedFilePath = getCacheBustedFilePath(rootDirectory, Path.resolve(sourceFilePath));
                const { program } = getFile(sourceFilePath);
                const file = { path: cacheBustedFilePath, program };
                programMap[cacheBustedFilePath] = file.program;
                const newDependantsMap = getDependantMap([file]);
                for (const newDependantsPath in newDependantsMap) {
                    dependantMap[newDependantsPath] = newDependantsMap[newDependantsPath];
                }
                FileSystem.writeFileSync(cacheBustedFilePath, generate(programMap[cacheBustedFilePath]), "utf8");
                cacheBust(getCacheBustedFilePath(rootDirectory, Path.resolve(sourceFilePath)), programMap, dependantMap);
                execute(cacheBustedModulePath, execution).then((newExecution) => execution = newExecution);
            }
        });
    }
    // const resolvedModulePath = Path.resolve(modulePath);
    // const rootDirectory = Path.dirname(modulePath);
    // const cacheBustedDirectory = Path.resolve(rootDirectory, ".cacheBusted");
    // await File.copy(rootDirectory, cacheBustedDirectory);
    // const resolvedCacheBustedModulePath = Path.resolve(cacheBustedDirectory, Path.relative(rootDirectory, modulePath));
    // const map = getDependencyMap(resolvedCacheBustedModulePath);

    // let unload: Function | undefined;


    // const tryLoad = async () => {
    //     const module = await import(cacheBustSpecifier(Url.pathToFileURL(resolvedCacheBustedModulePath).href));
    //     const { load, unload } = module;
    //     Data.assert(typeof load === "function", `Unable to import "load" function.`);
    //     load();
    // };

    // const filePaths = Object.entries(map).reduce((set, [key, value]) => {
    //     set.add(key);
    //     for (const path of value.dependants.map(({ path }) => path)) {
    //         set.add(path);
    //     }
    //     return set;
    // }, new Set<string>());

    // for (const filePath of filePaths) {
    //     if (filePath in map) {
    //         const data = map[filePath];
    //         await File.write(filePath, generate(data.program), "utf8");
    //         const watcher = watch(filePath);
    //         watcher.on("all", (event) => {
    //             console.log(event);
    //         });
    //     }
    // }

    // tryLoad();
}

startExecution("test/index.js");