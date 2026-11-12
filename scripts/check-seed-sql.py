#!/usr/bin/env python3
# Docs: docs/scripts/check-seed-sql.md
"""
Validate seed SQL files before seeding.

09-zt-mappings.sql — enum / NULL issues that would cause INSERT failures:
  - Invalid ZTPillar enum values (including all elements of the pillars array)
  - Empty pillars array
  - Invalid ZTMaturityLevel enum values
  - NULL in NOT NULL columns (function, maturityLevel)
  Values are read by column name from the INSERT's column list, so a column added,
  dropped or reordered cannot shift a check onto the wrong column.

ZTMM guidance resolution (09-zt-mappings.sql <-> 12-ztmm-guidance-updated.sql):
  ZeroTrustMapping resolves its display guidance by matching (first pillar,
  function) exactly against ZTMMGuidance at API read time — there is no FK.
  This validates that contract:
    - reports resolution coverage (how many mappings resolve to a guidance row),
    - FAILS on "near-miss drift": a (pillar, function) with no exact guidance row
      but one that DOES match after normalizing (strip trailing parenthetical,
      case-fold) — the editorial-rename trap, almost always an accidental mismatch.
  A coverage gap FAILS the run. Every mapping must resolve to a guidance row.
  The ratio is the only signal for a defect the other checks cannot see: a
  mis-quoted literal in the hand-authored guidance file reads as an identifier
  to Postgres, silently unresolves a whole (pillar, function) group, and leaves
  every other check green. If a gap is ever genuinely intended, the run has to
  be made to say so deliberately rather than tolerating a drifting count.

Baseline badge glyphs (every seed-sql/*.sql):
  The OSCAL source writes baseline values as glyph-prefixed prose ("\U0001F13B: 30 days").
  parseBaselineParams extracts those into ControlParameter rows and strips the glyphs, and
  the modal renders prose through a single path that does not parse them. A glyph surviving
  into seeded text would display raw, so this FAILS on any occurrence — and on a scan that
  found no files to read, since scanning nothing must not report as scanning clean.

Run via: make db-seed-check
"""

import difflib
import glob
import os
import re
import sys

# Seed SQL lives per catalog: one deployment holds one catalog, so the checks run
# against one directory per invocation. Declared, never inferred — see catalog-dir.ts.
CATALOG = os.environ.get('SEED_CATALOG', '').strip() or 'nist-800-53'
for _arg in sys.argv[1:]:
    if _arg.startswith('--catalog='):
        _value = _arg.split('=', 1)[1].strip()
        # Rejected, not ignored. Falling through resolved SEED_DIR to the seed root,
        # which exists as a directory, so assert_catalog_exists() passed and every
        # later check hit an absent-file branch — the script exited 0 having
        # validated nothing. `make db-seed-check CATALOG=` reaches this.
        if not _value:
            print('FAIL: --catalog= requires a catalog name')
            sys.exit(1)
        CATALOG = _value

SEED_ROOT = os.path.join('app', 'prisma', 'seed-sql')

# One directory per catalog (seed-sql/nist-800-53/).
SEED_DIR = os.path.join(SEED_ROOT, CATALOG)


def assert_catalog_exists():
    """Fail loudly on an unknown catalog. Called from main(), never at import:
    the test suite imports this module from another working directory, and a
    module-level exit takes pytest's collector down with it."""
    if os.path.isdir(SEED_DIR):
        return
    found = sorted(d for d in os.listdir(SEED_ROOT)
                   if os.path.isdir(os.path.join(SEED_ROOT, d))) if os.path.isdir(SEED_ROOT) else []
    print(f"FAIL: unknown catalog {CATALOG!r}; available: {', '.join(found) or '(none)'}")
    sys.exit(1)

MAPPINGS_PATH = os.path.join(SEED_DIR, '09-zt-mappings.sql')
GUIDANCE_PATH = os.path.join(SEED_DIR, '12-ztmm-guidance-updated.sql')
PARAMS_PATH = os.path.join(SEED_DIR, '07-control-parameters.sql')
CONTROLS_PATH = os.path.join(SEED_DIR, '04-controls.sql')
PARTS_PATH = os.path.join(SEED_DIR, '06-control-parts.sql')

# Backbone files every catalog seeds, overlay or not. A check whose file is missing
# has nothing to read, so the absence itself fails the run rather than being skipped.
BACKBONE_PATHS = (CONTROLS_PATH, PARTS_PATH, PARAMS_PATH)

# Backbone files that always carry rows. One that is empty, or holds only comments, reads
# as clean to every check, so it fails the run as a missing one does. 07 is not here: a
# catalog with no baseline parameters seeds it with comments only, as NIST's does.
NONEMPTY_PATHS = (CONTROLS_PATH, PARTS_PATH)

# Files whose rows are keyed to the mappings 09 seeds: part coverage and affinity. Either
# one with rows and no 09 fails the seed at that file. The other zt- files do not depend
# on 09: the guidance resolves by natural key, and the reference files key to controls.
MAPPING_DEPENDENT_PATHS = (
    os.path.join(SEED_DIR, '11-zt-part-coverage.sql'),
    os.path.join(SEED_DIR, '13-zt-mapping-affinity.sql'),
)

# Baseline indicator glyphs an OSCAL source can embed in prose. A seed generator
# extracts them into ControlParameter rows and strips them from the prose it emits,
# so seeded prose must carry none: the modal renders prose through one path that does
# not parse glyphs, and a glyph reaching the UI would display raw instead of as a
# badge. Unenforced, that invariant is an assumption.
BASELINE_BADGE_CHARS = ('\U0001F13B', '\U0001F13C', '\U0001F137', '\U0001F145')

# A baseline value/label still carrying an inline numbered-list boundary (" 2. foo" or a
# trailing " 2.'") — the AC-02 h/j flattened-list extraction bug. Single-digit list items
# (1-9) so a real value like "30. days" doesn't false-positive. Post-fix this must be zero.
PARAM_BLEED_RE = re.compile(r"\s[1-9]\.(\s+[a-z]|\s*')")

# ControlPart row: ('id', 'oscalPartId', 'label', 'name', ...). Captures the label,
# which is NULL on a statement root and a quoted marker on an item.
PART_LABEL_RE = re.compile(r"^  \('part_[^']*', '[^']*', (NULL|'((?:[^']|'')*)')", re.M)
# A marker the renderers know how to punctuate: bare ("a", "12"), period-suffixed
# ("a.", "12.") or bracketed ("(a)", "[1]"). The marker carries the nesting level,
# so it is kept as the catalog published it; formatPartLabel adds a separator only
# when there is not one already. Anything outside these shapes would render wrong.
KNOWN_LABEL_RE = re.compile(r"^(?:[A-Za-z0-9]+\.?|\([A-Za-z0-9]+\)|\[[A-Za-z0-9]+\])$")

# The ZeroTrustMapping columns the checks read. Absent from the INSERT's column list, the
# file fails rather than a check quietly reading nothing.
MAPPING_REQUIRED_COLUMNS = ('id', 'pillars', 'function', 'maturityLevel')
# NOT NULL columns checked for a NULL value wherever the column list names them. The
# catalog key is nistControlId on one line and arsControlId on the other; pillars has its
# own check, which a NULL fails.
MAPPING_NOT_NULL_COLUMNS = ('id', 'nistControlId', 'arsControlId', 'function', 'maturityLevel', 'createdById')

VALID_PILLAR = {'IDENTITY', 'DEVICES', 'NETWORKS', 'APPLICATIONS', 'DATA', 'CROSS_CUTTING', 'TBD'}
VALID_MATURITY = {'TRADITIONAL', 'INITIAL', 'ADVANCED', 'OPTIMAL', 'TBD'}

# ZTMMGuidance row: 'id', 'PILLAR'::"ZTPillar", 'function', 'functionGroup', 'base', ...
# Captures (id, pillar, function, functionGroup, base). Mappings resolve against functionGroup.
GUIDANCE_RE = re.compile(
    r"'((?:[^']|'')*)',\s*"           # id
    r"'([A-Z_]+)'::\"ZTPillar\",\s*"  # pillar
    r"'((?:[^']|'')*)',\s*"           # function
    r"'((?:[^']|'')*)',\s*"           # functionGroup
    r"'((?:[^']|'')*)',",             # base
    re.DOTALL,
)

# ZTPillar enum -> id slug prefix (ids are hand-authored as "<pillar-slug>.<...>").
PILLAR_SLUG = {
    "IDENTITY": "identity", "DEVICES": "devices", "NETWORKS": "networks",
    "APPLICATIONS": "applications", "DATA": "data", "CROSS_CUTTING": "cross-cutting", "TBD": "tbd",
}


def unescape(s):
    return s.replace("''", "'")


def sql_text(literal):
    """The text of a quoted SQL string literal ('it''s' -> it's); None for anything else."""
    match = re.fullmatch(r"'((?:[^']|'')*)'", literal)
    return unescape(match.group(1)) if match else None


def extract_pillars(line):
    """
    Parse pillar values from a PostgreSQL typed array literal.

    Handles ARRAY['IDENTITY', 'NETWORKS']::"ZTPillar"[] as the Zero Trust overlay generator writes it.
    Returns an empty list if the line doesn't match — caught downstream as a validation error.
    """
    match = re.search(r'ARRAY\[([^\]]*)\]::"ZTPillar"\[\]', line)
    if not match:
        return []
    inner = match.group(1).strip()
    if not inner:
        return []
    return [p.strip().strip("'") for p in inner.split(',')]


def read_zt_mappings(path):
    """
    Read 09-zt-mappings.sql's rows by column name, using the column list of the INSERT.

    Every check of this file reads through here. The file used to be read by line position
    in one check and by a pattern in another. When implementationGuidance was dropped from
    the table, the positional check went on reading whatever column had moved into its
    line, and passed. The pattern assumed function and maturityLevel sit side by side, so a
    column between them made it match nothing, and the coverage check compared 0 with 0.

    Returns (rows, errors): each row a dict of column name to the SQL literal as written.
    It is an error when the INSERT header is missing, a required column is missing, a row's
    value count does not match the column list, a row is not written one value per line,
    or there are no rows at all. Each of those would leave a check reading the wrong
    columns, or nothing.
    """
    with open(path) as f:
        content = f.read()

    header = re.search(r'INSERT INTO "ZeroTrustMapping" \((.*?)\)\s*VALUES', content, re.DOTALL)
    if not header:
        return [], ['  no INSERT INTO "ZeroTrustMapping" (...) VALUES header found']
    columns = re.findall(r'"(\w+)"', header.group(1))
    missing = [c for c in MAPPING_REQUIRED_COLUMNS if c not in columns]
    if missing:
        return [], [f"  column list is missing {', '.join(missing)}"]

    # One value per line, as the overlay generator writes it. A row opened on a line with
    # its values after it is written another way, and would not be read at all.
    body = content[header.end():]
    blocks = re.findall(r'\(\s*\n(.*?)\n\s*\)', body, re.DOTALL)
    openings = len(re.findall(r'^\s*\(', body, re.MULTILINE))
    rows, errors = [], []
    if openings == 0:
        errors.append("  no rows after the column list")
    elif openings != len(blocks):
        errors.append(
            f"  {openings - len(blocks)} of {openings} row(s) are not written one value per line"
        )

    for block in blocks:
        values = [ln.strip().rstrip(',') for ln in block.strip().split('\n')]
        if len(values) != len(columns):
            errors.append(f"  {values[0]}: {len(values)} values for {len(columns)} columns")
            continue
        rows.append(dict(zip(columns, values)))

    return rows, errors


def check_zt_mappings(path):
    """
    Check 09-zt-mappings.sql for invalid enum values and NULLs in NOT NULL columns, reading
    each row by column name through read_zt_mappings.

    Returns (rows, errors) where errors is a list of human-readable strings, including any
    the reader reports.
    """
    rows, errors = read_zt_mappings(path)

    for value in rows:
        zt_id    = value['id']
        pillars  = extract_pillars(value['pillars'])
        maturity = value['maturityLevel']

        # Pillar checks
        if not pillars:
            errors.append(f"  {zt_id}: missing or unparseable pillars array (got: {value['pillars']!r})")
        else:
            for p in pillars:
                if p not in VALID_PILLAR:
                    errors.append(f"  {zt_id}: invalid pillar value '{p}'")

        # Maturity — strip the ::"ZTMaturityLevel" cast to get the raw enum value
        maturity_match = re.search(r"'(\w+)'::", maturity)
        if not maturity_match:
            errors.append(f"  {zt_id}: unparseable maturity '{maturity}'")
        elif maturity_match.group(1) not in VALID_MATURITY:
            errors.append(f"  {zt_id}: invalid maturity '{maturity_match.group(1)}'")

        # NOT NULL columns
        for column in MAPPING_NOT_NULL_COLUMNS:
            if value.get(column) == 'NULL':
                errors.append(f"  {zt_id}: NULL {column} (NOT NULL column)")

    return rows, errors


class AmpersandInFunction(Exception):
    """Raised when a function name contains '&' instead of 'and' in a seed file."""
    def __init__(self, names):
        self.names = names
        super().__init__(f"{len(names)} function name(s) contain '&'")


def normalize_function(func):
    """Normalize for near-miss detection: drop trailing parenthetical annotation,
    strip the cross-cutting 'Capability' suffix, and case-fold. Stripping ' Capability'
    means a manual 'Governance' vs 'Governance Capability' mismatch under the same
    pillar is flagged as near-miss drift (FAIL), not a silent coverage gap."""
    s = re.sub(r"\s*\([^)]*\)\s*$", "", func.strip()).lower()
    s = re.sub(r"\s+capability$", "", s)
    return s


def check_guidance_coverage(mappings_path, guidance_path):
    """
    Validate the resolution contract between mappings and guidance. A mapping's
    (first pillar, function) resolves against a guidance row's (pillar, functionGroup):
    multi-part functions (e.g. "Identity Stores") have several member rows sharing a
    functionGroup, and the mapping resolves to the group.

    Returns (resolved, total, gaps, near_misses, orphans):
      resolved    — mappings whose (first pillar, function) matches a guidance functionGroup
      total       — total mappings
      gaps        — sorted list of (pillar, function) with no matching group even after
                    normalizing (FAIL condition; multi-function comma cells are tagged)
      near_misses — list of (pillar, mapping_fn, guidance_group) that would resolve if
                    the strings were aligned (FAIL condition)
      orphans     — sorted list of (pillar, functionGroup) authored in guidance that no
                    mapping reaches (informational; dead guidance or awaiting a 09 fix)
    """
    # Read by column name, as check_zt_mappings reads it; a row the reader rejects is
    # reported there and fails the run.
    rows, _errors = read_zt_mappings(mappings_path)
    mappings = []
    for row in rows:
        pillars = extract_pillars(row['pillars'])
        fn = sql_text(row['function'])
        if pillars and fn is not None:
            mappings.append((pillars[0], fn))
    with open(guidance_path) as f:
        guidance = [
            (p, unescape(fn), unescape(fg))
            for _id, p, fn, fg, _base in GUIDANCE_RE.findall(f.read())
        ]

    # Ampersand guard: function AND functionGroup must use 'and', never '&'.
    amp = sorted(
        {fn for _, fn in mappings if "&" in fn}
        | {fn for _, fn, _ in guidance if "&" in fn}
        | {fg for _, _, fg in guidance if "&" in fg}
    )
    if amp:
        raise AmpersandInFunction(amp)

    # A mapping resolves against the set of guidance GROUP keys (pillar, functionGroup).
    groups = {(p, fg) for p, _, fg in guidance}
    normalized = {(p, normalize_function(fg)): fg for p, _, fg in guidance}

    mapping_keys = set(mappings)
    resolved = sum(1 for key in mappings if key in groups)
    gaps = set()
    near_misses = []
    for p, fn in mappings:
        if (p, fn) in groups:
            continue
        norm_key = (p, normalize_function(fn))
        if norm_key in normalized and normalized[norm_key] != fn:
            near_misses.append((p, fn, normalized[norm_key]))
        else:
            gaps.add((p, fn))

    # Reverse direction: guidance groups authored in 12 that no mapping reaches.
    orphans = sorted(g for g in groups if g not in mapping_keys)

    return resolved, len(mappings), sorted(gaps), near_misses, orphans


def check_guidance_integrity(guidance_path):
    """
    Row-level integrity of 12-ztmm-guidance-updated.sql. Returns a list of error
    strings (empty = clean). FAIL conditions:
      - id not unique, or its pillar-slug prefix doesn't match the row's pillar.
        (ids are hand-authored short forms, so the full slug isn't enforced — only
        that `id` starts with "<pillar-slug>." and is unique.)
      - base empty (NOT NULL but '' would render the fallback / break concatenation).
      - two distinct functionGroups under one pillar that are near-duplicates
        (>=0.92 similar) — almost always a typo that silently splits a group.
    """
    with open(guidance_path) as f:
        rows = [
            (unescape(rid), p, unescape(fn), unescape(fg), unescape(base))
            for rid, p, fn, fg, base in GUIDANCE_RE.findall(f.read())
        ]

    errors = []
    seen_ids = {}
    groups_by_pillar = {}
    for rid, p, fn, fg, base in rows:
        # id uniqueness
        if rid in seen_ids:
            errors.append(f"  duplicate id '{rid}' (pillar {p}, function '{fn}')")
        seen_ids[rid] = True
        # id pillar-prefix
        prefix = PILLAR_SLUG.get(p, p.lower()) + "."
        if not rid.startswith(prefix):
            errors.append(f"  id '{rid}' should start with '{prefix}' for pillar {p}")
        # non-empty base
        if base.strip() == "":
            errors.append(f"  empty base for '{fn}' ({p}) — base is NOT NULL but must carry prose")
        groups_by_pillar.setdefault(p, set()).add(fg)

    # near-duplicate functionGroup within a pillar (likely a typo splitting a group)
    for p, fgs in groups_by_pillar.items():
        fgs = sorted(fgs)
        for i in range(len(fgs)):
            for j in range(i + 1, len(fgs)):
                if difflib.SequenceMatcher(None, fgs[i].lower(), fgs[j].lower()).ratio() >= 0.92:
                    errors.append(
                        f"  near-duplicate functionGroup under {p}: '{fgs[i]}' vs '{fgs[j]}' "
                        "— likely a typo splitting one group into two"
                    )
    return errors


def check_param_numbering_bleed(path):
    """07-control-parameters.sql must not carry inline numbered-list bleed (' 2. reauthorize …')
    in any value/label — the AC-02 h/j flattened-list extraction bug. Returns hit snippets."""
    with open(path) as f:
        content = f.read()
    hits = []
    for m in PARAM_BLEED_RE.finditer(content):
        start = max(0, m.start() - 25)
        hits.append(content[start:m.end() + 18].replace("\n", " ").strip())
    return hits


def check_part_label_convention(path):
    """06-control-parts.sql labels must be markers the renderers can punctuate.

    Both renderers go through formatPartLabel, which appends a period only when the
    published marker does not already end in one. That keeps the catalog's own
    marker intact — NIST uses "a." at level one, "1." at level two and "(a)" at
    level three, and those distinguish the nesting depth. Reducing them to a bare
    letter, as a parser that strips punctuation would, maps "a." and "(a)" onto the same
    label and loses the third level.

    So this does not impose one convention; it catches a marker outside every shape
    the renderer handles, which would otherwise render wrong on the page.

    Returns the offending labels with a count each.
    """
    with open(path) as f:
        content = f.read()
    bad = {}
    for m in PART_LABEL_RE.finditer(content):
        if m.group(1) == 'NULL':
            continue
        label = (m.group(2) or '').replace("''", "'")
        if label and not KNOWN_LABEL_RE.match(label):
            bad[label] = bad.get(label, 0) + 1
    return bad


def check_discussion_markup(path):
    """04-controls.sql discussion carries its references as markdown links — a control
    anchor `[AC-3](#ac-3)` opens that control, an outward `[label](https://...)` is a link —
    and as bare URLs, which the modal renders at render time. Returns (handled_count,
    unhandled): unhandled = link forms the modal does NOT render (`HYPERLINK "url"`
    formulas, HTML anchors, Excel =HYPERLINK(...) with a label arg) and would therefore
    reach the page as raw text."""
    with open(path) as f:
        content = f.read()
    handled = len(re.findall(r"\]\((?:https?://|#)", content))
    unhandled = []
    for label, pat in (
        ("HYPERLINK formula(s)", r'HYPERLINK\s+"https?://'),
        ("HTML anchor(s)", r"href\s*=\s*[\"']?https?://"),
        ("Excel =HYPERLINK(label) form(s)", r"=\s*HYPERLINK\s*\("),
    ):
        n = len(re.findall(pat, content))
        if n:
            unhandled.append(f"{n} {label}")
    return handled, unhandled


def check_baseline_badges_stripped(seed_dir):
    """No seed SQL file may carry a baseline badge glyph — the pipeline extracts them into
    ControlParameter rows and strips them, and both the statement renderer and the parameter
    badge renderer emit their text without parsing glyphs.

    Scans every .sql file in the directory rather than a hand-maintained list, so a new seed
    file is covered the day it lands. Returns (files_scanned, [(path, glyph, count, snippet)]).

    Raises FileNotFoundError when the directory is missing or holds no .sql files. Scanning
    nothing must never be reported as scanning clean; that ambiguity is the whole failure
    mode this check exists to close."""
    files = sorted(glob.glob(os.path.join(seed_dir, '*.sql')))
    if not files:
        raise FileNotFoundError(f"no .sql files under {seed_dir} — nothing was scanned")

    hits = []
    for path in files:
        with open(path, encoding='utf-8') as f:
            content = f.read()
        for glyph in BASELINE_BADGE_CHARS:
            count = content.count(glyph)
            if count:
                i = content.index(glyph)
                snippet = content[max(0, i - 40):i + 20].replace("\n", " ").strip()
                hits.append((path, glyph, count, snippet))
    return files, hits


# Comments as Postgres reads them: a string literal runs to the next quote that is not
# doubled, a line comment to the end of its line, and block comments nest. Each comment
# reads as a space. Literals are kept, so a "--" or "/*" inside one is not a comment.
_SQL_TOKEN_START = re.compile(r"'|--|/\*")
_SQL_LITERAL = re.compile(r"'(?:''|[^'])*'?")
_SQL_LINE_COMMENT = re.compile(r"--[^\r\n]*")
_SQL_COMMENT_EDGE = re.compile(r"/\*|\*/")


def without_comments(text):
    """SQL text with each comment replaced by a space."""
    out, i = [], 0
    while (m := _SQL_TOKEN_START.search(text, i)):
        out.append(text[i:m.start()])
        if m.group(0) == "'":
            literal = _SQL_LITERAL.match(text, m.start())
            out.append(literal.group(0))
            i = literal.end()
            continue
        if m.group(0) == "--":
            i = _SQL_LINE_COMMENT.match(text, m.start()).end()
        else:
            depth, i = 1, m.end()
            while depth and (edge := _SQL_COMMENT_EDGE.search(text, i)):
                depth += 1 if edge.group(0) == "/*" else -1
                i = edge.end()
            if depth:
                # Unterminated, which Postgres rejects: the rest of the file is comment.
                i = len(text)
        out.append(" ")
    out.append(text[i:])
    return "".join(out)


def uncommented_sql(path):
    """A seed file's text without its comments, read past any byte-order mark."""
    with open(path, encoding='utf-8-sig') as f:
        return without_comments(f.read())


def has_rows(path):
    """Whether a seed file inserts any rows: an INSERT INTO, or a COPY ... FROM, anywhere
    outside its comments and string literals."""
    sql = _SQL_LITERAL.sub("''", uncommented_sql(path))
    return re.search(r"\bINSERT\s+INTO\b|\bCOPY\b[^;]*?\bFROM\b", sql, re.I) is not None


def main():
    assert_catalog_exists()
    failed = False

    # --- Backbone files (04, 06, 07) — present for every catalog, overlay or not ---
    # Above the overlay gate, so a backbone-only seed cannot pass without them. The
    # 04 and 07 checks below sit past that gate and would never see the absence.
    missing = [p for p in BACKBONE_PATHS if not os.path.exists(p)]
    for path in missing:
        print(f"  ✗ {path} not found: every catalog seeds it")
    empty = [p for p in NONEMPTY_PATHS if os.path.exists(p) and not has_rows(p)]
    for path in empty:
        print(f"  ✗ {path} inserts no rows: every catalog seeds rows into it")
    if missing or empty:
        failed = True

    # --- 0. Part-label convention (06) — runs for every catalog, overlay or not ---
    try:
        bad_labels = check_part_label_convention(PARTS_PATH)
        if bad_labels:
            total = sum(bad_labels.values())
            print(f"\n  ✗ {total} control part label(s) are not a marker shape the renderer handles:")
            for label, n in sorted(bad_labels.items(), key=lambda kv: -kv[1])[:10]:
                print(f"    {label!r} x{n}")
            print("  Expected a bare, period-suffixed or bracketed marker. See formatPartLabel.")
            failed = True
        else:
            print(f"  \u2713 control part labels are renderable markers (06)")
    except FileNotFoundError:
        print("  \u2013 part label check not run (06 missing, reported above)")
        failed = True

    # --- 1. Baseline badge glyphs — the modal renders seeded text without parsing them ---
    # Above the overlay gate deliberately. It scans every .sql file in the catalog, so it
    # is meaningful for a backbone-only seed too. It used to sit below the early return,
    # which silently disabled it for exactly the overlay-less catalog this branch adds.
    try:
        scanned, badge_hits = check_baseline_badges_stripped(SEED_DIR)
    except FileNotFoundError as e:
        print(f"\n  ✗ baseline badge check could not run: {e}")
        failed = True
    else:
        if badge_hits:
            print(f"\n  ✗ {len(badge_hits)} baseline badge glyph(s) survived into seeded SQL:")
            for path, glyph, count, snippet in badge_hits:
                print(f"    {path}: {count}x {glyph!r} — …{snippet}…")
            print("  parseBaselineParams (oscal-parser.ts) must extract these into parameters and strip them.")
            failed = True
        else:
            print(f"  ✓ no baseline badge glyphs in {len(scanned)} seeded SQL file(s)")

    # Every check below reads the Zero Trust mappings (09). A catalog can be legitimately
    # seeded without them — the backbone loads and every control renders unmapped — so
    # their absence is reported and the checks skipped rather than treated as a broken
    # seed. Unless a file whose rows are keyed to those mappings still has rows: then the
    # seed fails at that file, and so does this run.
    if not os.path.exists(MAPPINGS_PATH):
        dependents = [p for p in MAPPING_DEPENDENT_PATHS if os.path.exists(p) and has_rows(p)]
        if dependents:
            for path in dependents:
                print(f"  ✗ {MAPPINGS_PATH} not found, but {os.path.basename(path)} inserts rows keyed to its mappings")
            print("The checks that read 09 are skipped.")
            sys.exit(1)
        print(f"Catalog {CATALOG!r} has no Zero Trust overlay ({os.path.basename(MAPPINGS_PATH)} absent).")
        print("Backbone-only seed: skipping the overlay checks.")
        if failed:
            sys.exit(1)
        return

    # --- 2. Enum / NULL validation on 09 ---
    try:
        rows, errors = check_zt_mappings(MAPPINGS_PATH)
    except FileNotFoundError:
        print(f"File not found: {MAPPINGS_PATH}")
        print("Run `cd app && yarn zt:generate --write` to regenerate.")
        sys.exit(1)

    print(f"Checked {len(rows)} ZT mapping records in {MAPPINGS_PATH}")
    if errors:
        print(f"\n{len(errors)} enum/NULL issue(s) found:")
        for err in errors:
            print(err)
        failed = True
    else:
        print("  All enum/NULL values valid")

    # --- 2. ZTMM guidance resolution contract (09 <-> 12) ---
    # With 09 present the overlay is incomplete without 12. That fails the run, and
    # the checks after the guidance checks still run: ending the run here used to
    # skip them and could exit 0.
    guidance_present = os.path.exists(GUIDANCE_PATH)
    if not guidance_present:
        print(f"\n  ✗ {GUIDANCE_PATH} not found: 09 is present, so the overlay is incomplete")
        failed = True
    else:
        try:
            resolved, total, gaps, near_misses, orphans = check_guidance_coverage(
                MAPPINGS_PATH, GUIDANCE_PATH
            )
        except AmpersandInFunction as e:
            print(f"\n  ✗ {e} — use 'and', not '&', in function names:")
            for n in e.names:
                print(f"    {n}")
            sys.exit(1)

        # Each ZeroTrustMapping carries a single representative function now (multi-function is
        # modeled relationally in ZTMappingAffinity, not flattened into comma cells), so every gap
        # is a genuine unauthored/mismapped function; no comma-split handling is needed.
        true_gaps = sorted(gaps)

        print(f"\nZTMM guidance coverage: {resolved}/{total} mappings resolve by (first pillar, functionGroup)")
        print(f"  unauthored / mismapped functions: {len(true_gaps)}")
        for p, fn in true_gaps:
            print(f"    {p:14s} {fn}")
        if orphans:
            print(f"  orphaned guidance (authored in 12, no mapping reaches it): {len(orphans)}")
            for p, fg in orphans:
                print(f"    {p:14s} {fg}")

        # Coverage is a gate, not a readout. 12-ztmm-guidance-updated.sql is the one
        # seed file with no generator behind it, so it is the one place a mis-quoted
        # string literal can still land — Postgres reads "Governance and Enforcement"
        # as an identifier, the row stops matching, and every mapping in that group
        # quietly resolves to nothing. Injecting exactly that defect drops coverage
        # from 296/296 to 243/296 while the run still exits 0 and still prints
        # "guidance row integrity OK"; the failure only surfaces when the seed loads.
        #
        # The shortfall collapses into a single (pillar, function) tuple, so counting
        # gap tuples does not see it either. The ratio is what moves, it was already
        # being computed here, and asserting it is the whole fix.
        # A file with an overlay but no readable mappings would otherwise resolve 0 of 0.
        if total == 0:
            print("\n  ✗ no mappings were read from 09, so there is no coverage to check.")
            failed = True
        elif resolved < total:
            print(f"\n  ✗ {total - resolved} of {total} mapping(s) resolve to no guidance row.")
            print("  Check 12-ztmm-guidance-updated.sql for a mis-quoted literal (double")
            print("  quotes are identifiers in Postgres, not strings) before assuming the")
            print("  gap is real. If it is real, the (pillar, function) tuples are listed above.")
            failed = True
        else:
            print(f"\n  ✓ all {total} mappings resolve to a guidance row")

        if near_misses:
            print(f"\n  ✗ {len(near_misses)} NEAR-MISS DRIFT — guidance exists but the function string differs:")
            for p, fn, guidance_fn in sorted(near_misses):
                print(f"    {p:14s} mapping='{fn}'  vs  guidance='{guidance_fn}'")
            print("\n  Align the function strings in 09-zt-mappings.sql and 12-ztmm-guidance-updated.sql.")
            failed = True
        else:
            print("\n  ✓ no near-miss drift")

    # --- 3. 12-ztmm-guidance row integrity (id prefix/uniqueness, base, group typos) ---
    if not guidance_present:
        print("  – guidance integrity check not run (12 missing, reported above)")
    else:
        integrity_errors = check_guidance_integrity(GUIDANCE_PATH)
        if integrity_errors:
            print(f"\n  ✗ {len(integrity_errors)} guidance integrity issue(s):")
            for err in integrity_errors:
                print(err)
            failed = True
        else:
            print("  ✓ guidance row integrity OK (id prefix/uniqueness, non-empty base, no group typos)")

    # --- 4. Parameter numbered-list bleed (07) — the AC-02 flattened-list extraction regression ---
    try:
        bleed = check_param_numbering_bleed(PARAMS_PATH)
        if bleed:
            print(f"\n  ✗ {len(bleed)} parameter value(s) carry inline numbered-list bleed (' N. …'):")
            for h in bleed[:10]:
                print(f"    …{h}…")
            print("  Re-check the flattened-list split in parseBaselineParams (oscal-parser.ts).")
            failed = True
        else:
            print("  ✓ no parameter numbered-list bleed (07)")
    except FileNotFoundError:
        print("  – param bleed check not run (07 missing, reported above)")
        failed = True

    # --- 5. Discussion link markup (04) — every link form must be one the modal renders ---
    try:
        handled, unhandled = check_discussion_markup(CONTROLS_PATH)
        print(f"  ✓ discussion links: {handled} markdown link(s) (the modal renders these)")
        if unhandled:
            print(f"\n  ✗ link markup the modal would render raw: {', '.join(unhandled)}")
            print("  Flatten these in the generator, or extend renderDiscussion (ControlModal.tsx).")
            failed = True
    except FileNotFoundError:
        print("  – discussion markup check not run (04 missing, reported above)")
        failed = True

    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
