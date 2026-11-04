/**
 * Runs once when a Next.js server starts, before it serves a request. It validates the
 * environment at boot: the standalone server never loads `next.config.js`, so without this a
 * misconfigured container would start, pass its health check and fail on the first request
 * that needed the settings. With nothing configured the check passes, so an anonymous app,
 * local or deployed, starts as before.
 *
 * The check lives in its own module, imported only on the Node.js runtime, because it exits
 * the process and the Edge runtime has no `process.exit`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvironmentAtStartup } =
      await import("./instrumentation-node");
    await checkEnvironmentAtStartup();
  }
}
