import { execFileSync } from "node:child_process";

/**
 * The role and database a local seed reaches through the dev container.
 *
 * DATABASE_URL names the database; the container only supplies a psql binary.
 * Reading both from the URL keeps the docker path and the plain-psql fallback
 * pointed at the same place, so a URL naming a scratch database never seeds
 * the default one instead.
 *
 * Both values are interpolated into a shell command, so anything other than a
 * plain identifier is refused rather than quoted.
 */
export function dockerPsqlTarget(databaseUrl: string): {
  user: string;
  database: string;
} {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  for (const [label, value] of [
    ["user", user],
    ["database", database],
  ] as const) {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new Error(
        `DATABASE_URL ${label} ${JSON.stringify(value)} is not a plain identifier; refusing to pass it to psql.`,
      );
    }
  }
  return { user, database };
}

/**
 * The URL, or null when Node's URL parser refuses it. psql accepts forms the parser does
 * not, such as several hosts (`h1:5432,h2:5432`) or an unencoded `#` in a password; such a
 * URL is never the dev container, and goes to psql unchanged.
 */
export function parseUrl(databaseUrl: string): URL | null {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

/**
 * The database a URL names, or null when the URL does not parse or its name does not
 * decode (`db%zz`). Never the URL itself.
 */
export function databaseNameOf(databaseUrl: string): string | null {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

/**
 * The host ports in `docker port` output, one binding per line (`0.0.0.0:5439`, `[::]:5439`).
 * docker-compose.yml decides the dev database's port, and the seed asks the container for
 * it rather than keeping a second copy.
 */
export function publishedPorts(dockerPortOutput: string): string[] {
  const ports = dockerPortOutput
    .split("\n")
    .map((line) => /:(\d+)$/.exec(line.trim())?.[1])
    .filter((port): port is string => port !== undefined);
  return [...new Set(ports)];
}

/** Runs a command and returns its standard output; throws when the command fails. */
export type RunCommand = (file: string, args: readonly string[]) => string;

const run: RunCommand = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });

/**
 * The ports the dev container publishes Postgres on, asked of the container itself. Empty
 * when Docker or the container is not there, or Docker does not answer within five
 * seconds, and the seed then goes to psql.
 */
export function devContainerPorts(runCommand: RunCommand = run): string[] {
  try {
    return publishedPorts(
      runCommand("docker", ["port", "zt-decoder-ring-db", "5432/tcp"]),
    );
  } catch {
    return [];
  }
}

/**
 * Whether DATABASE_URL names the dev container: this machine, on a port the container
 * publishes. Only then may the seed go through the container. Any other URL, another
 * host or a scratch database on another local port, is seeded with psql against that
 * URL, so the container never takes a seed meant for somewhere else.
 */
export function pointsAtDevContainer(
  databaseUrl: string,
  devPorts: readonly string[],
): boolean {
  const url = parseUrl(databaseUrl);
  if (!url) return false;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname,
  );
  return local && devPorts.includes(url.port || "5432");
}

/** How a seed reaches the database DATABASE_URL names, decided once for the run. */
export type SeedRoute =
  | { via: "container"; user: string; database: string }
  | { via: "psql"; reason: "elsewhere" | "not-identifier" };

/**
 * Through the dev container with the URL's role and database, or with psql against the
 * URL: `elsewhere` when the URL names somewhere other than the dev container, and
 * `not-identifier` for a role or database the container path refuses (`zt-scratch`),
 * which psql takes as written.
 *
 * Throws when the URL names the dev container with no role or no database. psql would
 * then pick one itself, the OS user or a database named after the role, and seed it.
 */
export function devContainerTarget(
  databaseUrl: string,
  devPorts: readonly string[],
): SeedRoute {
  if (!pointsAtDevContainer(databaseUrl, devPorts)) {
    return { via: "psql", reason: "elsewhere" };
  }
  // pointsAtDevContainer only answers true for a URL that parses.
  const url = new URL(databaseUrl);
  const missing = !url.username
    ? "role"
    : url.pathname.replace(/^\//, "") === ""
      ? "database"
      : null;
  if (missing) {
    throw new Error(
      `DATABASE_URL names the dev container but no ${missing}; refusing to seed whichever one psql would pick.`,
    );
  }
  try {
    return { via: "container", ...dockerPsqlTarget(databaseUrl) };
  } catch {
    return { via: "psql", reason: "not-identifier" };
  }
}

/**
 * psql's connection argument and environment for a URL. The password moves from the URL
 * to PGPASSWORD, so `ps` never shows it. A URL Node cannot parse, or whose password does
 * not decode, goes to psql as written.
 */
export function psqlConnection(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; env: NodeJS.ProcessEnv } {
  const url = parseUrl(databaseUrl);
  if (!url?.password) return { url: databaseUrl, env };
  let password: string;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    return { url: databaseUrl, env };
  }
  url.password = "";
  return { url: url.href, env: { ...env, PGPASSWORD: password } };
}

/**
 * The error to throw when psql fails on a seed file. execFileSync's own error repeats the
 * command line, the URL with it, so this one names only the file and how psql ended;
 * psql has already written its error to stderr.
 */
export function psqlFailure(err: unknown, file: string): Error {
  const { code, status, signal } = err as {
    code?: string;
    status?: number | null;
    signal?: string | null;
  };
  if (code === "ENOENT") {
    return new Error(`psql is not on PATH, and seeding ${file} needs it.`);
  }
  const ended =
    status != null
      ? `exited with status ${status}`
      : signal
        ? `was stopped by ${signal}`
        : "failed";
  return new Error(`psql ${ended} on ${file}; its error is above.`);
}
