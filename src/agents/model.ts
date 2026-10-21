import { repair,steering, timeout, s } from "rig";

export function createCommon() {
  return {
    maxTurns: 3,
    addons: [timeout({ timeout: Number(process.env["SDLC_TIMEOUT_MS"] ?? 300_000) }), steering(), repair()],
  };
}

export  const SEVERITY = s.enum("blocker", "major", "minor", "nit");
export  const ESTIMATE = s.enum("XS", "S", "M", "L", "XL");
