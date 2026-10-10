/**
 * Templates for `sdlc init`, keyed by relative path.
 *
 * Empty when running from source (templates are read from ./templates).
 * scripts/build-binary.ts fills this in at bundle time so the standalone
 * binary can run `sdlc init` without the templates folder next to it.
 */
export const EMBEDDED_TEMPLATES: Record<string, string> = {};
