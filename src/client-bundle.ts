// The browser code is TypeScript (it shares src/game with the server), so it
// is bundled with esbuild — in memory, at startup in production and on every
// request in development. There is no build output on disk to go stale and no
// build step to forget before a restart: a deploy stays pull, install,
// restart. esbuild is in `dependencies` for that reason.
import path from "node:path";
import * as esbuild from "esbuild";
import { config } from "./config.js";

const ENTRIES = { "game.js": "src/client/game.ts", "editor.js": "src/client/editor.ts" } as const;
export type BundleName = keyof typeof ENTRIES;

const built = new Map<BundleName, string>();

async function build(name: BundleName): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [path.resolve(ENTRIES[name])],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    minify: config.isProduction,
    sourcemap: config.isProduction ? false : "inline",
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

export async function prebuildBundles() {
  for (const name of Object.keys(ENTRIES) as BundleName[]) built.set(name, await build(name));
}

export async function bundle(name: string): Promise<string | null> {
  if (!(name in ENTRIES)) return null;
  const key = name as BundleName;
  if (config.isProduction && built.has(key)) return built.get(key)!;
  const code = await build(key);
  built.set(key, code);
  return code;
}
