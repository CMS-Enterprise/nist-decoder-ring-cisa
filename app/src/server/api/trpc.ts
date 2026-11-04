/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/auth";
import {
  type AuthEnv,
  oidcConfigured,
  readAuthSettings,
} from "~/server/auth/settings";
import { db } from "~/server/db";
import {
  findCatalogVocabulary,
  servesOwnIdentity,
} from "~/server/api/catalog-boundary";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  // With no issuer configured there is no session to read, and asking Auth.js for one would
  // only fail its host check in production. An unconfigured app is anonymous by design.
  // Read from process.env, not ~/env: importing ~/env here would validate the whole
  // environment wherever the router is loaded, tests included; startup already does that.
  const session = oidcConfigured(readAuthSettings(process.env as AuthEnv))
    ? await auth()
    : null;

  return {
    db,
    session,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  // Development only. tRPC's own isDev is any NODE_ENV but production, so it was true
  // under the test runner too, and every procedure call in the unit suite waited.
  if (process.env.NODE_ENV === "development") {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * The catalog boundary, enforced on the way out.
 *
 * Inspects the result of every procedure and refuses to serve one that carries
 * catalog vocabulary, naming the path and the text. Composed into both procedure
 * builders so a procedure added later inherits it; the walk and its exemption live
 * in `catalog-boundary.ts`, which is covered, and only the composition sits here. A
 * procedure serving the signed-in person's own details is passed through; see
 * `servesOwnIdentity` there for why.
 * An error from the resolver passes through untouched. The excerpt that
 * tripped the check is logged here and never put in the error: the formatter
 * passes the message through to the client unchanged, and the text the
 * boundary exists to withhold must not leave the server inside its own refusal.
 */
export const catalogBoundary = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (!result.ok || servesOwnIdentity(path)) return result;
  const hit = findCatalogVocabulary(result.data);
  if (hit) {
    console.error(
      `[catalog boundary] ${path} served catalog vocabulary at ${hit.path}: ${hit.excerpt}`,
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${path} served catalog vocabulary at ${hit.path}`,
    });
  }
  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
  .use(timingMiddleware)
  .use(catalogBoundary);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(catalogBoundary)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });
