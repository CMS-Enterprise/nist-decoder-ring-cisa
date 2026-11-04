import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  databaseNameOf,
  devContainerPorts,
  devContainerTarget,
  dockerPsqlTarget,
  pointsAtDevContainer,
  psqlConnection,
  psqlFailure,
  publishedPorts,
} from "../docker-psql-target.js";

// The dev container's published port in these tests; the seed asks the container for it.
const DEV = ["5439"];

describe("dockerPsqlTarget", () => {
  it("reads the role and database from DATABASE_URL", () => {
    expect(
      dockerPsqlTarget(
        "postgresql://ztdecoder:secret@localhost:5439/zt_decoder_ring_scratch",
      ),
    ).toEqual({ user: "ztdecoder", database: "zt_decoder_ring_scratch" });
  });

  it("ignores query parameters", () => {
    expect(
      dockerPsqlTarget(
        "postgresql://ztdecoder:secret@localhost:5439/zt_decoder_ring?sslmode=disable",
      ).database,
    ).toBe("zt_decoder_ring");
  });

  it("refuses a URL with no database", () => {
    expect(() =>
      dockerPsqlTarget("postgresql://ztdecoder:secret@localhost:5439/"),
    ).toThrow(/database "" is not a plain identifier/);
  });

  it("refuses a name that would leave the psql argument", () => {
    expect(() =>
      dockerPsqlTarget(
        "postgresql://ztdecoder:secret@localhost:5439/db%3Brm%20-rf",
      ),
    ).toThrow(/not a plain identifier/);
  });
});

describe("pointsAtDevContainer", () => {
  it("is true for this machine on the dev container's port, by name or address", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        pointsAtDevContainer(`postgresql://u:p@${host}:5439/db`, DEV),
      ).toBe(true);
    }
  });

  it("is false for another local port, so a scratch database is not seeded through the container", () => {
    expect(
      pointsAtDevContainer("postgresql://u:p@localhost:55441/db", DEV),
    ).toBe(false);
    expect(pointsAtDevContainer("postgresql://u:p@localhost/db", DEV)).toBe(
      false,
    );
  });

  it("is false for any other host", () => {
    for (const host of ["db.example.gov", "10.0.0.5", "db"]) {
      expect(
        pointsAtDevContainer(`postgresql://u:p@${host}:5439/db`, DEV),
      ).toBe(false);
    }
  });
});

// psql accepts URLs that Node's parser refuses: several hosts, or an unencoded `#` in a
// password. Such a URL is never the dev container, and must not fail the seed before it
// reaches psql.
describe("URLs Node cannot parse", () => {
  const unparseable = [
    "postgresql://u:p@h1:5432,h2:5432/db",
    "postgresql://u:p#ss@localhost:5439/db",
  ];

  it("are not the dev container, and do not throw", () => {
    for (const url of unparseable) {
      expect(pointsAtDevContainer(url, DEV)).toBe(false);
    }
  });

  it("have no database name to log, so the URL is never printed", () => {
    for (const url of unparseable) {
      expect(databaseNameOf(url)).toBeNull();
    }
  });

  it("leave a parseable URL's database name intact", () => {
    expect(
      databaseNameOf("postgresql://u:p@localhost:5439/zt_decoder_ring"),
    ).toBe("zt_decoder_ring");
  });

  it("have no database name when the name does not decode, rather than throwing", () => {
    expect(databaseNameOf("postgresql://u:p@localhost:5439/db%zz")).toBeNull();
  });
});

describe("devContainerTarget", () => {
  it("goes through the container with the URL's role and database when the URL names it", () => {
    expect(
      devContainerTarget(
        "postgresql://ztdecoder:secret@localhost:5439/zt_decoder_ring",
        DEV,
      ),
    ).toEqual({
      via: "container",
      user: "ztdecoder",
      database: "zt_decoder_ring",
    });
  });

  it("goes to psql for a name the container path refuses, instead of stopping", () => {
    expect(
      devContainerTarget("postgresql://u:p@localhost:5439/zt-scratch", DEV),
    ).toEqual({ via: "psql", reason: "not-identifier" });
  });

  it("goes to psql for any URL that is not the dev container", () => {
    for (const url of [
      "postgresql://u:p@db.example.gov:5439/db",
      "postgresql://u:p@h1:5432,h2:5432/db",
    ]) {
      expect(devContainerTarget(url, DEV)).toEqual({
        via: "psql",
        reason: "elsewhere",
      });
    }
  });

  // psql would connect to a database named after the role, or as the OS user, and seed it.
  it("refuses the dev container with no database or no role, rather than letting psql pick one", () => {
    for (const url of [
      "postgresql://ztdecoder:pw@localhost:5439/",
      "postgresql://ztdecoder:pw@localhost:5439",
      "postgresql://ztdecoder:pw@localhost:5439?sslmode=disable",
    ]) {
      expect(() => devContainerTarget(url, DEV)).toThrow(/no database/);
    }
    expect(() =>
      devContainerTarget("postgresql://localhost:5439/zt_decoder_ring", DEV),
    ).toThrow(/no role/);
  });
});

describe("psqlConnection", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: "/usr/bin" };

  it("moves the password to PGPASSWORD, decoded, and leaves the rest of the URL as written", () => {
    expect(
      psqlConnection(
        "postgresql://app%2Duser:p%40ss%3Aw0rd@db.example.gov:5432/zt?sslmode=verify-full",
        env,
      ),
    ).toEqual({
      url: "postgresql://app%2Duser@db.example.gov:5432/zt?sslmode=verify-full",
      env: { ...env, PGPASSWORD: "p@ss:w0rd" },
    });
  });

  it("leaves a URL with no password, or one Node cannot parse, as written", () => {
    for (const url of [
      "postgresql://u@localhost:5439/db",
      "postgresql://u:p@h1:5432,h2:5432/db",
    ]) {
      expect(psqlConnection(url, env)).toEqual({ url, env });
    }
  });

  it("leaves a URL whose password does not decode as written", () => {
    const url = "postgresql://u:p%zz@localhost:5439/db";
    expect(psqlConnection(url, env)).toEqual({ url, env });
  });
});

describe("psqlFailure", () => {
  const url = "postgresql://u:hunter2@db.example.gov/db";

  // The errors execFileSync really throws, so the test follows Node's message format.
  function thrownBy(file: string, args: string[]): unknown {
    try {
      execFileSync(file, args, { stdio: "ignore" });
    } catch (err) {
      return err;
    }
    throw new Error(`${file} did not fail`);
  }

  it("names the file and exit status, never the command line or its password", () => {
    const err = thrownBy("sh", ["-c", "exit 3", url]);
    expect(String((err as Error).message)).toContain("hunter2");
    const failure = psqlFailure(err, "04-controls.sql");
    expect(failure.message).toBe(
      "psql exited with status 3 on 04-controls.sql; its error is above.",
    );
    expect(failure.message).not.toContain("hunter2");
    expect(failure).not.toHaveProperty("cause");
  });

  it("says when psql is not installed", () => {
    const err = thrownBy("zt-no-such-psql", [url]);
    expect(psqlFailure(err, "00-cleanup.sql").message).toBe(
      "psql is not on PATH, and seeding 00-cleanup.sql needs it.",
    );
  });
});

describe("publishedPorts", () => {
  it("reads the host port from each binding docker reports", () => {
    expect(publishedPorts("0.0.0.0:5439\n[::]:5439\n")).toEqual(["5439"]);
  });

  it("is empty when nothing is published", () => {
    expect(publishedPorts("")).toEqual([]);
  });
});

describe("devContainerPorts", () => {
  it("asks the container for the port it publishes", () => {
    const calls: [string, readonly string[]][] = [];
    const ports = devContainerPorts((file, args) => {
      calls.push([file, args]);
      return "0.0.0.0:5439\n[::]:5439\n";
    });
    expect(ports).toEqual(["5439"]);
    expect(calls).toEqual([
      ["docker", ["port", "zt-decoder-ring-db", "5432/tcp"]],
    ]);
  });

  it("is empty when Docker or the container is not there, so the seed goes to psql", () => {
    expect(
      devContainerPorts(() => {
        throw new Error("No such container: zt-decoder-ring-db");
      }),
    ).toEqual([]);
  });
});

describe("pointsAtDevContainer, with the container's port", () => {
  it("follows a port the container publishes elsewhere", () => {
    expect(
      pointsAtDevContainer("postgresql://u:p@localhost:6543/db", ["6543"]),
    ).toBe(true);
    expect(pointsAtDevContainer("postgresql://u:p@localhost:5439/db", [])).toBe(
      false,
    );
  });
});
