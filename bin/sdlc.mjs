#!/usr/bin/env node
// Rig ships TypeScript sources, so load the CLI through tsx's loader.
import { register } from "tsx/esm/api";
register();
await import("../src/cli.ts");
