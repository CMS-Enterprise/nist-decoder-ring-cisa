import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const authRouter = createTRPCRouter({
  /** The signed-in user. Refused without a session, which is what proves sign-in works end to end. */
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.session.user.id,
    name: ctx.session.user.name ?? null,
    email: ctx.session.user.email ?? null,
  })),
});
