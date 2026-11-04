import { createHash } from "node:crypto";

import {
  FACET_KEYS,
  normalizeControlId,
} from "~/app/_components/decoder-ring/filterPredicate";
import { LINE_DATASETS, LINE_FIELDS } from "~/lib/export/from-detail";
import type { ExportFormat, ExportSelection } from "~/lib/export/selection";

/**
 * The export route's guard against an anonymous caller asking for the whole catalog on
 * repeat. A built file is kept per catalog version, format and selection, a request for
 * one already being built waits on that build, and at most `maxBuilds` run at once.
 */

export interface ExportFile {
  file: Buffer;
  name: string;
  etag: string;
}

interface Entry extends ExportFile {
  expires: number;
}

export const BUSY = Symbol("busy");

const sorted = (xs: readonly string[]) => [...new Set(xs)].sort();

/**
 * One key for every URL that exports the same file, read the way getExportRecord reads
 * them: values sorted, picks canonical, the facets ignored once there are picks, and a
 * dataset or field the app does not carry dropped. Anything else would let a caller
 * force a fresh build with a parameter that changes nothing.
 */
export function exportCacheKey(
  versionId: string,
  format: ExportFormat,
  s: ExportSelection,
): string {
  const picked = s.pick.length > 0;
  const facets = FACET_KEYS.map((k) => [k, picked ? [] : sorted(s[k])]);
  // Hashed, so a long search text costs the cache no more than a short one.
  const parts = JSON.stringify([
    versionId,
    format,
    facets,
    picked ? "" : s.q.trim().toLowerCase(),
    sorted(s.pick.map(normalizeControlId)),
    s.enhancements,
    sorted(s.data.filter((d) => LINE_DATASETS.includes(d))),
    sorted(s.fields.filter((f) => LINE_FIELDS.includes(f))),
  ]);
  return createHash("sha256").update(parts).digest("base64url");
}

/** A build that ran past the cache's deadline; its slot is freed for the next request. */
export class BuildTimeout extends Error {
  constructor() {
    super("The export took too long to build. Try again in a minute.");
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BuildTimeout()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export class ExportCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<ExportFile>>();
  private bytes = 0;
  private building = 0;

  constructor(
    private readonly opts: {
      maxBytes: number;
      ttlMs: number;
      maxBuilds: number;
      timeoutMs: number;
      now?: () => number;
    },
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private drop(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.file.length;
  }

  /** `build` says whether its file may be kept, so a caller can refuse one it doubts. */
  async get(
    key: string,
    build: () => Promise<ExportFile & { cacheable: boolean }>,
  ): Promise<ExportFile | typeof BUSY> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) {
      // Re-insert so the Map's order stays least recently used first.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    this.drop(key);

    const pending = this.inflight.get(key);
    if (pending) return pending;
    if (this.building >= this.opts.maxBuilds) return BUSY;

    this.building++;
    // A build stuck on a stalled connection would otherwise hold its slot until restart.
    const promise = withDeadline(build(), this.opts.timeoutMs)
      .then(({ cacheable, ...file }) => {
        const entry = { ...file, expires: this.now() + this.opts.ttlMs };
        if (cacheable && file.file.length <= this.opts.maxBytes) {
          this.entries.set(key, entry);
          this.bytes += file.file.length;
          for (const oldest of this.entries.keys()) {
            if (this.bytes <= this.opts.maxBytes) break;
            this.drop(oldest);
          }
        }
        return entry;
      })
      .finally(() => {
        this.building--;
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

// A seed rebuilds rows under the same deterministic version id, so the TTL is what
// bounds a stale file. 50 MB holds about 150 whole-catalog exports.
export const exportCache = new ExportCache({
  maxBytes: 50 * 1024 * 1024,
  ttlMs: 15 * 60 * 1000,
  maxBuilds: 2,
  // The whole catalog takes about 15 s in the capped container.
  timeoutMs: 60 * 1000,
});
