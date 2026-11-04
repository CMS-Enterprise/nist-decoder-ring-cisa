/**
 * Getting the catalog, and knowing which one you got.
 *
 * The readable 10.4 MB catalog is fetched at a pinned commit rather than
 * committed, and the minified copy in `sources/nist-800-53/` is the fallback when the network
 * is unavailable or upstream has moved. Both are the same content; only the
 * whitespace differs.
 *
 * Drift warns and falls back rather than failing the build, which is a
 * deliberate choice with a known cost: a warning nobody reads is how a stale
 * pin ships. So the resolved source and its hash are returned for the caller to
 * stamp into the generated files themselves — "which input produced this seed"
 * has to be answerable from the artifact, not from a CI log that scrolled away.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** usnistgov/oscal-content. Moving this is a deliberate act: re-download,
 *  update sources/nist-800-53/SOURCE.md with the new blob SHAs, and read the count deltas. */
export const PIN = "78650f02ad9321bb7b817846f8fbd4f2bcd620de";

const RAW_BASE = `https://raw.githubusercontent.com/usnistgov/oscal-content/${PIN}/nist.gov/SP800-53/rev5/json`;

export const CATALOG_READABLE = "NIST_SP-800-53_rev5_catalog.json";
export const CATALOG_MINIFIED = "NIST_SP-800-53_rev5_catalog-min.json";

/** Git blob SHA-1 at the pin, as GitHub reports it. */
export const EXPECTED_BLOB_SHA: Readonly<Record<string, string>> = {
  [CATALOG_READABLE]: "8ebe3c91181cc078d40e39bcf34ea233e652d025",
  [CATALOG_MINIFIED]: "81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91",
  "NIST_SP-800-53_rev5_LOW-baseline_profile.json":
    "fe2ee0d4a982945479d1c2c61737302c35cfbec8",
  "NIST_SP-800-53_rev5_MODERATE-baseline_profile.json":
    "a5da8cff72abe52b819b69dbe225ad7c4d780c8e",
  "NIST_SP-800-53_rev5_HIGH-baseline_profile.json":
    "05cbae1c0276f4fdff1f18cb3e521b13ac3ff9ea",
  "NIST_SP-800-53_rev5_PRIVACY-baseline_profile.json":
    "85025c21e392ab4d67ad4b4490bbff6871811945",
};

/** The release before the pinned one, compared with it for the release delta. Read only
 *  from its committed copy. When PIN moves to a new release, the release it leaves
 *  becomes this one; see sources/nist-800-53/SOURCE.md. */
export const PREVIOUS_PIN = "941c978d14c57379fbf6f7fb388f675067d5bff7";
export const PREVIOUS_CATALOG = "NIST_SP-800-53_rev5.1.1_catalog-min.json";
const PREVIOUS_BLOB_SHA = "bf69d80e8e46d7c4f5c3d3b2aa37c48c01c5e816";

/**
 * The SP 800-53A assessment procedures, from NIST's CPRT rather than from oscal-content.
 *
 * CPRT is a weaker upstream than a git commit in two specific ways, which is why the committed copy is the input of record rather than a cache. It serves the export under a request-stamped filename (`cprt-SP_800_53_A_5_2_0-20260916-171002.json`) and with `no-store`, so there is no immutable URL and no upstream blob SHA to compare against; the endpoint's stability across CPRT releases is not something it promises. Two fetches 45 seconds apart were byte-identical when the pin was taken, which is enough to pin by hash and not enough to trust blindly.
 *
 * That is the reason the fallback matters MORE here than for the catalog, not a reason to skip the fetch: without a live check, a stale committed copy is indistinguishable from a current one and would keep seeding quietly for as long as nobody re-downloaded by hand.
 */
export const CPRT_EXPORT = "cprt-SP_800_53_A_5_2_0.json";
export const CPRT_EXPORT_URL =
  "https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/SP_800_53_A_5_2_0/export/json?element=all";
export const CPRT_EXPORT_SHA256 =
  "82a0a904385c8954b80c3156ca6b36408b332597ec065cf706c3fbbbb26fb936";

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * The CPRT export: fetched live, verified against the recorded SHA-256, and falling back to the committed copy.
 *
 * Three outcomes, each saying which one happened in the provenance line stamped into the generated SQL:
 *
 *   - live fetch matches the pin — use it, and the committed copy is confirmed current
 *   - live fetch DIFFERS — alert, and use the committed copy anyway
 *   - no network, or `--offline` — warn, and use the committed copy
 *
 * A delta alerts rather than silently winning because a changed upstream must not change what this seed emits without someone deciding to move the pin. Falling back to the known input keeps the run reproducible; the alert is what stops the stale copy from living forever.
 *
 * There is deliberately no cleanup path to write, because nothing is written: the fetch lands in memory and is discarded, so a run never leaves a second copy of an 11 MB export on disk for someone to confuse with the pinned one. Adopting a new upstream is the operator's explicit act, and the alert prints the steps.
 *
 * A committed copy that fails its own hash is fatal. There is nothing to fall back to, and a rewritten pinned input is exactly the case where "which input produced this seed" must not be answered with a guess.
 */
export async function resolveCprtExport(
  dataDir: string,
  { offline = false }: { offline?: boolean } = {},
): Promise<ResolvedInput> {
  const committed = readFileSync(join(dataDir, CPRT_EXPORT));
  const committedSha = sha256(committed);
  if (committedSha !== CPRT_EXPORT_SHA256) {
    throw new Error(
      `${CPRT_EXPORT} hashes sha256 ${committedSha}, but SOURCE.md records ${CPRT_EXPORT_SHA256}. ` +
        `Something rewrote a pinned input. Re-fetch from ${CPRT_EXPORT_URL} and, if the content has genuinely changed, move the pin deliberately.`,
    );
  }

  const base: ResolvedInput = {
    name: CPRT_EXPORT,
    origin: "fallback",
    blobSha1: gitBlobSha1(committed),
    verified: true,
    content: committed,
  };

  if (offline) return { ...base, note: "offline requested" };

  const fetched = await tryFetchUrl(CPRT_EXPORT_URL);
  if (!fetched) {
    console.warn(
      `  WARNING: could not reach CPRT for ${CPRT_EXPORT}. Using the committed copy, which is verified but unconfirmed against upstream.`,
    );
    return { ...base, note: "fetch unavailable" };
  }

  const liveSha = sha256(fetched);
  if (liveSha === CPRT_EXPORT_SHA256) {
    return { ...base, origin: "fetch", content: fetched };
  }

  console.warn(
    [
      ``,
      `  ALERT: the CPRT export upstream no longer matches the pinned copy.`,
      `    pinned (committed, in use): ${CPRT_EXPORT_SHA256}`,
      `    live at ${CPRT_EXPORT_URL}`,
      `             ${liveSha}  (${fetched.length} bytes)`,
      `  This run used the COMMITTED copy, so its output is unchanged and reproducible.`,
      `  The stored JSON is now stale. To adopt the new publication deliberately:`,
      `    curl -o app/prisma/sources/nist-800-53/${CPRT_EXPORT} "${CPRT_EXPORT_URL}"`,
      `    # update CPRT_EXPORT_SHA256 in fetch-inputs.ts and the table in sources/nist-800-53/SOURCE.md to ${liveSha}`,
      `    # regenerate, then read the count deltas before widening any floor`,
      `  Nothing was written to disk by this run, so there is no downloaded duplicate to clean up.`,
      ``,
    ].join("\n"),
  );
  return { ...base, note: `upstream moved to sha256 ${liveSha}` };
}

/**
 * One line naming the assessment input, stamped into 08.
 *
 * Deliberately says nothing about which path produced it, unlike the catalog's line. A fetch is only adopted when it hashes to the pin, so both paths carry byte-identical content, and an artifact that changed because the network was up would make a run non-reproducible for no information gain. Which path ran is a fact about the run and goes to the console; the hash is the fact about the input and goes in the file.
 */
export function cprtProvenanceLine(input: ResolvedInput): string {
  return `Source: ${input.name} (sha256 ${CPRT_EXPORT_SHA256.slice(0, 12)}, verified) blob ${input.blobSha1} @ CPRT SP_800_53_A_5_2_0`;
}

/** Git's object hash: sha1("blob <byteLength>\0" + content). The same value
 *  `git hash-object` prints and GitHub reports, so provenance is checkable with
 *  a command anyone already has. */
export function gitBlobSha1(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

export interface ResolvedInput {
  /** File name the content came from. */
  name: string;
  /** "pinned fetch" or "committed fallback". */
  origin: "fetch" | "fallback";
  blobSha1: string;
  /** True when the content matched the SHA recorded for it at the pin. */
  verified: boolean;
  content: Buffer;
  /** Set when the fetch was not used, saying why. */
  note?: string;
}

/** One line naming exactly what was ingested, stamped into every generated file. */
export function provenanceLine(input: ResolvedInput): string {
  const state = input.verified ? "verified" : "UNVERIFIED";
  return `Source: ${input.name} (${input.origin}, ${state}) blob ${input.blobSha1} @ oscal-content ${PIN.slice(0, 12)}`;
}

/** GET a URL into memory, or null on any failure. Nothing reaches disk: a run must
 *  not leave a second copy of a pinned input lying next to the real one. */
async function tryFetchUrl(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function tryFetch(name: string): Promise<Buffer | null> {
  return tryFetchUrl(`${RAW_BASE}/${name}`);
}

/**
 * The catalog: readable copy at the pin, else the committed minified one.
 *
 * A fetch that succeeds but hashes wrong is treated as a miss, not as a new
 * pin — content served for a fixed commit should not change, and if it has,
 * falling back to a copy whose provenance is recorded is the safer answer.
 */
export async function resolveCatalog(
  dataDir: string,
  { offline = false }: { offline?: boolean } = {},
): Promise<ResolvedInput> {
  if (!offline) {
    const fetched = await tryFetch(CATALOG_READABLE);
    if (fetched) {
      const sha = gitBlobSha1(fetched);
      if (sha === EXPECTED_BLOB_SHA[CATALOG_READABLE]) {
        return {
          name: CATALOG_READABLE,
          origin: "fetch",
          blobSha1: sha,
          verified: true,
          content: fetched,
        };
      }
      console.warn(
        `  WARNING: ${CATALOG_READABLE} fetched at the pin hashes ${sha}, expected ` +
          `${EXPECTED_BLOB_SHA[CATALOG_READABLE]}. Upstream changed content for a fixed commit. ` +
          `Using the committed copy instead.`,
      );
    } else {
      console.warn(
        `  WARNING: could not fetch ${CATALOG_READABLE} at the pin. Using the committed copy.`,
      );
    }
  }

  const content = readFileSync(join(dataDir, CATALOG_MINIFIED));
  const sha = gitBlobSha1(content);
  const verified = sha === EXPECTED_BLOB_SHA[CATALOG_MINIFIED];
  if (!verified) {
    console.warn(
      `  WARNING: the committed ${CATALOG_MINIFIED} hashes ${sha}, which is not what ` +
        `SOURCE.md records. Something rewrote a pinned input.`,
    );
  }
  return {
    name: CATALOG_MINIFIED,
    origin: "fallback",
    blobSha1: sha,
    verified,
    content,
    note: offline ? "offline requested" : "fetch unavailable or unverified",
  };
}

/** A committed profile, verified against its recorded SHA. */
export function readProfile(dataDir: string, name: string): ResolvedInput {
  const content = readFileSync(join(dataDir, name));
  const sha = gitBlobSha1(content);
  const expected = EXPECTED_BLOB_SHA[name];
  const verified = sha === expected;
  if (!verified) {
    console.warn(
      `  WARNING: ${name} hashes ${sha}, expected ${expected}. Baseline membership may not be the published one.`,
    );
  }
  return { name, origin: "fallback", blobSha1: sha, verified, content };
}

/** The previous release's committed catalog. A hash mismatch throws rather than warns:
 *  the release delta is seeded from this file, and a wrong file would seed a wrong delta
 *  with nothing to show for it. */
export function readPreviousCatalog(dataDir: string): ResolvedInput {
  const content = readFileSync(join(dataDir, PREVIOUS_CATALOG));
  const sha = gitBlobSha1(content);
  if (sha !== PREVIOUS_BLOB_SHA) {
    throw new Error(
      `${PREVIOUS_CATALOG} hashes ${sha}, expected ${PREVIOUS_BLOB_SHA} at oscal-content ${PREVIOUS_PIN}.`,
    );
  }
  return {
    name: PREVIOUS_CATALOG,
    origin: "fallback",
    blobSha1: sha,
    verified: true,
    content,
  };
}
