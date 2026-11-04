import { afterEach, describe, expect, it, vi } from "vitest";

type ExecFileSync = (
  file: string,
  args: string[],
  options: { env: Record<string, string | undefined> },
) => void;
const execFileSync = vi.hoisted(() => vi.fn<ExecFileSync>());
vi.mock("node:child_process", () => ({ execFileSync }));

import { applyMigrations } from "../migrate";

describe("applyMigrations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the CLI against the URL it is given, with no DOTENV_* key in its environment", () => {
    // Either name turns dotenv's override on, and the path option picks the file it reads.
    vi.stubEnv("DOTENV_OVERRIDE", "1");
    vi.stubEnv("DOTENV_CONFIG_OVERRIDE", "true");
    vi.stubEnv("DOTENV_PATH", "/elsewhere/.env");
    vi.stubEnv("DATABASE_URL", "postgresql://dev@localhost:5439/dev");

    applyMigrations("postgresql://test@localhost:55000/test");

    const [, args, options] = execFileSync.mock.calls[0]!;
    expect(args).toEqual(["migrate", "deploy"]);
    expect(
      Object.keys(options.env).filter((k) => k.startsWith("DOTENV_")),
    ).toEqual([]);
    expect(options.env.DATABASE_URL).toBe(
      "postgresql://test@localhost:55000/test",
    );
  });
});
