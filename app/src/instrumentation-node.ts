/**
 * The Node.js half of the boot check, kept out of `instrumentation.ts` so the Edge bundle
 * never sees `process.exit`. Importing `env.js` validates the environment; on a bad
 * configuration the process exits, since Next.js would otherwise log the error and keep
 * running, answering every request with a 500.
 */
export async function checkEnvironmentAtStartup() {
  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      `Startup stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
