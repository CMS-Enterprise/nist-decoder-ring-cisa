import { connection } from "next/server";

import { env } from "~/env";
import { auth, signIn, signOut } from "~/server/auth";
import {
  OIDC_PROVIDER_ID,
  oidcConfigured,
  readAuthSettings,
} from "~/server/auth/settings";

/**
 * The header's sign-in control, present only when a deployment sets `AUTH_SIGNIN_LINK` and an
 * OIDC issuer. "Sign in" goes straight to the issuer rather than through Auth.js's chooser
 * page. Without the setting nothing renders and the session is never read; sign-in is then
 * reached at `/api/auth/signin`.
 *
 * `connection()` comes first so the settings are read per request. The image is built with
 * no sign-in settings, so without it the page would be prerendered then with no control, and
 * setting `AUTH_SIGNIN_LINK` on the running container would change nothing.
 */
export async function SignInControl() {
  await connection();
  const settings = readAuthSettings(env);
  if (!settings.signInLink || !oidcConfigured(settings)) return null;

  const session = await auth();
  const button =
    "rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-blue-600 focus:outline-none";

  if (session?.user) {
    return (
      <HeaderRow>
        <form
          className="flex items-center gap-3"
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <span className="text-sm text-slate-700">
            {session.user.name ?? session.user.email}
          </span>
          <button type="submit" className={button}>
            Sign out
          </button>
        </form>
      </HeaderRow>
    );
  }

  return (
    <HeaderRow>
      <form
        action={async () => {
          "use server";
          await signIn(OIDC_PROVIDER_ID);
        }}
      >
        <button type="submit" className={button}>
          {settings.name ? `Sign in with ${settings.name}` : "Sign in"}
        </button>
      </form>
    </HeaderRow>
  );
}

/** The header's top-right row, rendered only when the control has something to show. */
function HeaderRow({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-6xl justify-end">{children}</div>;
}
