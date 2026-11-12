import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Two projects. `unit` is the whole pre-existing suite: jsdom, mocked Prisma,
// fast, Docker-free. `integration` runs the handful of *.integration.test.ts
// files against a real Postgres in a throwaway container.
//
// The package.json scripts pin `--project unit`, because a bare `vitest` runs
// EVERY project — without that pin, `make ci-test` would silently start
// requiring Docker the moment this block existed. `make test-integration`
// selects the other project explicitly.
//
// Both projects carry `extends: true`. A project does not inherit root options
// otherwise, and the root is where the `~` alias, the react plugin and the
// coverage config live; without it the unit project stops resolving
// `~/server/...` imports.
const INTEGRATION_GLOB = "**/*.integration.test.ts";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // e2e/ holds Playwright's browser tests (make test-browser); their *.spec.ts names
    // match vitest's default pattern, so they are kept out here.
    exclude: ["**/node_modules/**", ".next/**", "e2e/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          exclude: [
            "**/node_modules/**",
            ".next/**",
            "e2e/**",
            INTEGRATION_GLOB,
          ],
          // As in the integration project below: the auth configuration imports
          // next-auth, whose "next/server" import Node's ESM resolver rejects unless
          // Vite resolves it.
          server: { deps: { inline: ["next-auth"] } },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: [INTEGRATION_GLOB],
          globalSetup: ["./src/test/db/global-setup.ts"],
          // One shared database, so files must not run in parallel workers.
          fileParallelism: false,
          // A cold image pull plus migrate plus a 1.4 MB seed happens in
          // globalSetup; the defaults of 5s/10s are sized for unit tests.
          hookTimeout: 120_000,
          testTimeout: 30_000,
          // next-auth imports "next/server" without an extension, which Node's ESM
          // resolver rejects when the package is left external. Inlining it lets Vite
          // resolve the import, so the sign-in round trip runs the real route handlers.
          server: { deps: { inline: ["next-auth"] } },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Every source file counts, imported by a test or not. Without this list Vitest
      // reports only the files some test loads, so a module every test mocks (the
      // database client, the auth wiring) or none imports (a route handler) never
      // appeared in the report, and the floors below never measured it.
      include: ["src/**/*.{ts,tsx,js}", "prisma/**/*.ts", "scripts/**/*.ts"],
      exclude: [
        "node_modules/",
        "generated/",
        ".next/",
        "**/*.config.ts",
        "**/*.config.js",
        "**/vitest.setup.ts",
        // Next.js page shells: the root layout, the cake's layout and the home page only
        // render the bridge and its providers, which are covered where they are defined.
        "src/app/layout.tsx",
        "src/app/(cake)/layout.tsx",
        "src/app/(cake)/page.tsx",
        // The NIST pipeline's pure modules ARE covered — parser, profile reader,
        // parameter resolver, writers and both gates. Only the side-effectful
        // shells are excluded, matching how check-links and version-guard are
        // treated below: generate-seed.ts is the argv/process.exit orchestration
        // and fetch-inputs.ts is network I/O.
        "prisma/generators/catalog/generate-seed.ts",
        "prisma/generators/catalog/fetch-inputs.ts",
        // Reference-link pipeline: the two entry points are argv/fs/network
        // shells; everything under its lib/ is pure and covered.
        "prisma/generators/reference-links/retrieve.ts",
        "prisma/generators/reference-links/build.ts",
        "prisma/generators/zt-reference-links/retrieve.ts",
        "prisma/generators/zt-reference-links/build.ts",
        // Zero Trust overlay: the three entry points are argv/fs shells; the
        // reader, transform, union and writers under its lib/ are covered.
        "prisma/generators/zt-overlay/transform.ts",
        "prisma/generators/zt-overlay/generate.ts",
        // Link-checker: the entry point + source collectors + live HTTP
        // prober are side-effectful (DB / fs / network / stdout). Only the pure
        // format validators (scripts/check-links/validate.ts) are unit-tested
        // and stay covered — these are excluded so CI coverage stays ≥80%.
        "scripts/check-links.ts",
        "scripts/check-links/sources.ts",
        "scripts/check-links/report.ts",
        // Version guard: index.ts is the fs/argv/process.exit shell. The
        // comparison logic it calls (compare.ts) is fully unit tested.
        "scripts/version-guard/index.ts",
        // Test support: fixture builders and the real-DB harness are consumed
        // by tests, not by the application. Counting them would let an unused
        // builder lower the app's ratio without any app code changing.
        "src/test/**",
      ],
      // A ratchet, not an aspiration: each floor sits a little under what the suite
      // actually achieves, so the gate locks in coverage already earned instead of
      // leaving a dozen points of slack a regression could quietly spend. Raise a
      // floor when its metric has held above it for a while; never lower one to make
      // a red build green — cover the branch or exclude the file with a reason.
      //
      // Measured when set: lines 98.5, statements 97.6, functions 95.4, branches 92.3,
      // over only the files some test imported. Measured again 2026-10-29, once every
      // source file counted: lines 98.61, statements 97.76, functions 97.7, branches
      // 90.85, over 2,520 lines, 2,818 statements, 785 functions and 2,100 branches.
      // Branches sit closest to their floor, so a change that adds untested
      // conditionals shows there first.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 90,
        branches: 88,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
