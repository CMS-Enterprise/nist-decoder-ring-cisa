/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The version in this package.json, inlined into the bundle at build time and shown in the footer, so
// a running image reports the version it was built from, whatever its tag says.
const { version } = /** @type {{ version: string }} */ (
  JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"))
);

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default config;
