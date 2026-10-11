/**
 * Loads sdlc settings and API keys from the project's .env files.
 *
 * - Looks in the current directory, then each parent up to the git root,
 *   and uses the first directory that has `.env` or `.env.local`.
 * - `.env.local` overrides `.env`; variables already set in the shell override both.
 * - Only keys sdlc uses are loaded (see SDLC_ENV_KEYS). Everything sdlc loads
 *   is inherited by your test command and by the Cursor/Codex CLIs, so loading
 *   a whole app .env (DATABASE_URL, NODE_ENV, ...) could change how tests run.
 *   Set SDLC_DOTENV_ALL=1 to load every key anyway.
 * - `--dotenv <path>` loads that file instead; `--no-dotenv` or SDLC_NO_DOTENV=1 turns loading off.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const EXACT_KEYS = new Set(["GOOGLE_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN"]);
const KEY_PREFIXES = ["SDLC_", "ANTHROPIC_", "OPENAI_", "CODEX_", "CURSOR_", "GEMINI_", "COPILOT_", "RIG_"];

export function isSdlcKey(key: string): boolean {
  return EXACT_KEYS.has(key) || KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Parses dotenv syntax: KEY=value, `export KEY=value`, # comments, single/double/back quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // Quoted values may span lines until the closing quote.
      let body = value.slice(1);
      while (!hasClosingQuote(body, quote) && i + 1 < lines.length) body += "\n" + lines[++i];
      const end = closingQuoteIndex(body, quote);
      value = end === -1 ? body : body.slice(0, end);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\(["\\])/g, "$1");
    } else {
      // Unquoted: strip an inline comment (" #...") and surrounding spaces.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

function closingQuoteIndex(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

function hasClosingQuote(body: string, quote: string): boolean {
  return closingQuoteIndex(body, quote) !== -1;
}

/** First directory from `start` up to the git root (or filesystem root) that holds a .env file. */
export function findEnvDir(start = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".env")) || existsSync(join(dir, ".env.local"))) return dir;
    const parent = dirname(dir);
    if (existsSync(join(dir, ".git")) || parent === dir) return undefined;
    dir = parent;
  }
}

export type DotenvResult = { files: string[]; loaded: string[]; skipped: number };

export function loadProjectEnv(options: { envFile?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): DotenvResult {
  const env = options.env ?? process.env;
  const result: DotenvResult = { files: [], loaded: [], skipped: 0 };
  if (env["SDLC_NO_DOTENV"] === "1" || env["SDLC_NO_DOTENV"] === "true") return result;

  let files: string[];
  if (options.envFile) {
    const file = resolve(options.cwd ?? process.cwd(), options.envFile);
    if (!existsSync(file)) throw new Error(`--dotenv not found: ${file}`);
    files = [file];
  } else {
    const dir = findEnvDir(options.cwd);
    if (!dir) return result;
    // .env.local is read last so it overrides .env.
    files = [join(dir, ".env"), join(dir, ".env.local")].filter((f) => existsSync(f));
  }

  const merged: Record<string, string> = {};
  for (const file of files) Object.assign(merged, parseDotenv(readFileSync(file, "utf8")));
  result.files = files;

  const loadAll = env["SDLC_DOTENV_ALL"] === "1" || merged["SDLC_DOTENV_ALL"] === "1";
  for (const [key, value] of Object.entries(merged)) {
    if (!loadAll && !isSdlcKey(key)) {
      result.skipped++;
      continue;
    }
    if (env[key] !== undefined) continue; // the shell wins
    env[key] = value;
    result.loaded.push(key);
  }
  return result;
}
