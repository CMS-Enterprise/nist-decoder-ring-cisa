import { authRouter } from "~/server/api/routers/auth";
import { decoderRouter, exportRouter } from "~/server/api/routers/decoder";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  decoder: decoderRouter,
  auth: authRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);

/** The export's caller, for the file route only: exportRouter is not part of appRouter. */
export const createExportCaller = createCallerFactory(exportRouter);
