import { env } from "~/env";

/**
 * The version this bundle was built from: `package.json`'s, inlined by `next.config.js`. Undefined
 * outside a Next build, as under Vitest.
 */
export const appVersion: string | undefined = env.NEXT_PUBLIC_APP_VERSION;
