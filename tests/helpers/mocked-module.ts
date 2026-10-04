import { build } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";

const compiledModules = new Map<string, Promise<string>>();

/** Bundle real implementation code while replacing only its external dependencies. */
export async function loadMockedModule<T>(
  entry: string, mocks: Record<string, Record<string, unknown>>, globals: Record<string, unknown> = {},
): Promise<T> {
  const key = JSON.stringify([entry, Object.keys(mocks).sort()]);
  let compiled = compiledModules.get(key);
  if (!compiled) {
    compiled = build({
      entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
      plugins: [{ name: "isolated-fixtures", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
          ? { path: args.path, namespace: "fixture" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
          Object.keys(mocks[args.path]).map(name =>
            `${name === "default" ? "export default" : `export const ${name} =`} globalThis.mockModules[${JSON.stringify(args.path)}][${JSON.stringify(name)}];`
          ).join("\n"),
        }));
      } }],
    }).then(result => result.outputFiles[0].text);
    compiledModules.set(key, compiled);
  }
  const fixtureModule = { exports: {} };
  vm.runInNewContext(await compiled, {
    module: fixtureModule, exports: fixtureModule.exports, require: createRequire(import.meta.url),
    Date, Response, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, process: { env: {} }, mockModules: mocks, ...globals,
  });
  // The fixture's module type describes the real exported implementation bundled above.
  return fixtureModule.exports as T;
}
