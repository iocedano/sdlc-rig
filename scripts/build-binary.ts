/**
 * Builds a standalone `sdlc` executable with Bun (no Node or node_modules needed to run it).
 *
 *   bun scripts/build-binary.ts                       # binary for this machine -> dist/sdlc
 *   bun scripts/build-binary.ts --target bun-darwin-arm64
 *   bun scripts/build-binary.ts --all                 # macOS, Linux and Windows binaries
 *
 * Two build-time patches:
 *  1. Rig starts its own launcher CLI when it thinks it is the entry module
 *     (`process.argv[1] === import.meta.url`). Inside a compiled binary every
 *     module shares one path, so that check is true; we force it to false.
 *  2. The `init` templates are embedded into src/embedded-templates.ts.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BunPlugin } from "bun";

const ROOT = join(import.meta.dir, "..");
const TARGETS = {
  "bun-linux-x64": "sdlc-linux-x64",
  "bun-linux-arm64": "sdlc-linux-arm64",
  "bun-darwin-x64": "sdlc-macos-x64",
  "bun-darwin-arm64": "sdlc-macos-arm64",
  "bun-windows-x64": "sdlc-windows-x64.exe",
} as const;
type Target = keyof typeof TARGETS;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

async function embeddedTemplatesModule(): Promise<string> {
  const dir = join(ROOT, "templates");
  const entries: Record<string, string> = {};
  for (const file of await listFiles(dir)) {
    // Always use "/" so paths are valid on every OS once joined at runtime.
    entries[relative(dir, file).split(sep).join("/")] = await readFile(file, "utf8");
  }
  return `export const EMBEDDED_TEMPLATES: Record<string, string> = ${JSON.stringify(entries, null, 2)};\n`;
}

const IS_MAIN = "const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;";

const sdlcPlugin = (templatesSource: string): BunPlugin => ({
  name: "sdlc-binary",
  setup(build) {
    build.onLoad({ filter: /skills[\\/]rig[\\/]rig\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      if (!source.includes(IS_MAIN)) {
        throw new Error("Rig's entry-point check changed; update IS_MAIN in scripts/build-binary.ts");
      }
      return { contents: source.replace(IS_MAIN, "const isMain = false;"), loader: "ts" };
    });
    build.onLoad({ filter: /src[\\/]embedded-templates\.ts$/ }, () => ({ contents: templatesSource, loader: "ts" }));
  },
});

async function build(target: Target | undefined, outfile: string) {
  const result = await Bun.build({
    entrypoints: [join(ROOT, "src/cli.ts")],
    compile: {
      outfile,
      ...(target ? { target } : {}),
      // Behave like the Node version: read real environment variables only.
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    minify: true,
    plugins: [sdlcPlugin(await embeddedTemplatesModule())],
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`build failed for ${target ?? "host"}`);
  }
  console.log(`built ${relative(ROOT, outfile)}`);
}

const args = process.argv.slice(2);
const targetArg = args.includes("--target") ? (args[args.indexOf("--target") + 1] as Target) : undefined;
if (targetArg && !(targetArg in TARGETS)) {
  throw new Error(`Unknown target "${targetArg}". Use one of: ${Object.keys(TARGETS).join(", ")}`);
}

if (args.includes("--all")) {
  for (const [target, name] of Object.entries(TARGETS) as Array<[Target, string]>) {
    await build(target, join(ROOT, "dist", name));
  }
} else if (targetArg) {
  await build(targetArg, join(ROOT, "dist", TARGETS[targetArg]));
} else {
  await build(undefined, join(ROOT, "dist", process.platform === "win32" ? "sdlc.exe" : "sdlc"));
}
