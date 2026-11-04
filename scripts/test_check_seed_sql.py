"""Tests for check-seed-sql.py: each check against synthetic fixtures, clean and broken,
and the script as a whole, which must exit 1 on every defect a check finds.

The module name has a hyphen, so it is loaded via importlib rather than a plain import.
Run with: make test-seed-checks
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

_MOD_PATH = Path(__file__).resolve().parent / "check-seed-sql.py"
_spec = importlib.util.spec_from_file_location("check_seed_sql", _MOD_PATH)
check_seed_sql = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_seed_sql)


def _mapping(pillars, function, maturity="TRADITIONAL"):
    arr = ", ".join(f"'{p}'" for p in pillars)
    return (
        "  (\n"
        "    'zt_x',\n"
        "    'ctrl_x',\n"
        f"    ARRAY[{arr}]::\"ZTPillar\"[],\n"
        f"    '{function}',\n"
        f"    '{maturity}'::\"ZTMaturityLevel\",\n"
        "    'guidance',\n"
        "  ),\n"
    )


def _guidance(id_, pillar, function, group, base="base text"):
    return (
        "  (\n"
        f"    '{id_}',\n"
        f"    '{pillar}'::\"ZTPillar\",\n"
        f"    '{function}',\n"
        f"    '{group}',\n"
        f"    '{base}',\n"
        "    NULL, NULL, NULL, NULL,\n"
        "    'system_nist_gov', NOW(), NOW()\n"
        "  ),\n"
    )


# The column list _mapping's six values sit under. The checker reads 09 by name from it.
_MAPPING_HEADER = (
    'INSERT INTO "ZeroTrustMapping" (\n'
    '  "id",\n  "nistControlId",\n  "pillars",\n  "function",\n  "maturityLevel",\n  "createdById"\n'
    ")\nVALUES\n"
)


def _write(tmp_path, mappings_sql, guidance_sql):
    m = tmp_path / "09.sql"
    g = tmp_path / "12.sql"
    m.write_text(_MAPPING_HEADER + mappings_sql)
    g.write_text(guidance_sql)
    return str(m), str(g)


def test_resolve_gap_orphan_classification(tmp_path):
    mappings = (
        _mapping(["IDENTITY"], "Access Management")          # resolves to a singleton group
        + _mapping(["IDENTITY"], "Identity Stores")          # resolves to a multi-part group
        + _mapping(["DEVICES"], "Access Management")         # gap: no DEVICES/Access Management group
    )
    guidance = (
        _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
        + _guidance("identity.stores-users", "IDENTITY", "Identity Stores-Users", "Identity Stores")
        + _guidance("data.logging", "DATA", "Data Logging", "Data Logging")  # orphan
    )
    mp, gp = _write(tmp_path, mappings, guidance)
    resolved, total, gaps, near_misses, orphans = check_seed_sql.check_guidance_coverage(mp, gp)
    assert (resolved, total) == (2, 3)
    assert gaps == [("DEVICES", "Access Management")]
    assert near_misses == []
    assert orphans == [("DATA", "Data Logging")]


def test_orphan_detection_flags_unreached_group(tmp_path):
    """The reverse-orphan check must surface an authored group that no mapping reaches."""
    mappings = _mapping(["IDENTITY"], "Access Management")
    guidance = (
        _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
        + _guidance("networks.threat", "NETWORKS", "Network Threat Protection", "Network Threat Protection")
    )
    mp, gp = _write(tmp_path, mappings, guidance)
    resolved, _total, _gaps, _near, orphans = check_seed_sql.check_guidance_coverage(mp, gp)
    assert resolved == 1
    assert orphans == [("NETWORKS", "Network Threat Protection")]


def test_near_miss_capability_suffix_is_drift_not_gap(tmp_path):
    """A mapping dropping the cross-cutting 'Capability' suffix is near-miss drift, not a gap."""
    mappings = _mapping(["IDENTITY"], "Governance and Enforcement")
    guidance = _guidance(
        "identity.gov", "IDENTITY",
        "Governance and Enforcement Capability", "Governance and Enforcement Capability",
    )
    mp, gp = _write(tmp_path, mappings, guidance)
    resolved, _total, gaps, near_misses, _orphans = check_seed_sql.check_guidance_coverage(mp, gp)
    assert resolved == 0
    assert gaps == []
    assert near_misses == [("IDENTITY", "Governance and Enforcement", "Governance and Enforcement Capability")]


def test_ampersand_in_function_raises(tmp_path):
    mappings = _mapping(["IDENTITY"], "Access & Management")
    guidance = _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
    mp, gp = _write(tmp_path, mappings, guidance)
    try:
        check_seed_sql.check_guidance_coverage(mp, gp)
        assert False, "expected AmpersandInFunction to be raised"
    except check_seed_sql.AmpersandInFunction:
        pass


# --- baseline badge glyphs must not survive into seeded SQL -----------------


def _seed_file(tmp_path, name, text):
    (tmp_path / name).write_text(text, encoding="utf-8")
    return str(tmp_path)


def test_badge_glyph_in_prose_is_reported(tmp_path):
    """A glyph left in prose is a hit, with its count and a locating snippet."""
    d = _seed_file(
        tmp_path,
        "06-control-parts.sql",
        "INSERT INTO \"ControlPart\" VALUES ('p1', 'Retain records for "
        "\U0001F13B: 30 days \U0001F13B: 30 days');\n",
    )
    files, hits = check_seed_sql.check_baseline_badges_stripped(d)
    assert len(files) == 1
    assert len(hits) == 1
    path, glyph, count, snippet = hits[0]
    assert path.endswith("06-control-parts.sql")
    assert glyph == "\U0001F13B"
    assert count == 2
    assert "Retain records for" in snippet


def test_stripped_prose_has_no_hits(tmp_path):
    """Prose the pipeline already stripped produces no hits, and the scan reports its files."""
    d = _seed_file(
        tmp_path,
        "06-control-parts.sql",
        "INSERT INTO \"ControlPart\" VALUES ('p1', 'Retain records for 30 days');\n",
    )
    files, hits = check_seed_sql.check_baseline_badges_stripped(d)
    assert hits == []
    assert len(files) == 1


def test_all_four_glyphs_are_checked(tmp_path):
    """Every baseline glyph is in the set, not just the LOW marker."""
    d = _seed_file(
        tmp_path,
        "04-controls.sql",
        "\U0001F13B a \U0001F13C b \U0001F137 c \U0001F145 d\n",
    )
    _files, hits = check_seed_sql.check_baseline_badges_stripped(d)
    assert sorted(g for _p, g, _c, _s in hits) == sorted(
        check_seed_sql.BASELINE_BADGE_CHARS
    )


def test_every_sql_file_is_scanned_not_a_named_pair(tmp_path):
    """A seed file added later is covered without editing the checker."""
    (tmp_path / "04-controls.sql").write_text("clean\n", encoding="utf-8")
    (tmp_path / "07-control-parameters.sql").write_text("clean\n", encoding="utf-8")
    (tmp_path / "99-brand-new.sql").write_text("\U0001F137: 5 days\n", encoding="utf-8")
    files, hits = check_seed_sql.check_baseline_badges_stripped(str(tmp_path))
    assert len(files) == 3
    assert [p for p, _g, _c, _s in hits] == [str(tmp_path / "99-brand-new.sql")]


def test_empty_scan_raises_rather_than_reporting_clean(tmp_path):
    """Scanning no files must never look like scanning clean — the failure mode this closes.

    An earlier version swallowed the missing-file case and returned the same empty result a
    genuinely clean scan returns, which main() then printed as a checkmark."""
    empty = tmp_path / "seed-sql"
    empty.mkdir()
    try:
        check_seed_sql.check_baseline_badges_stripped(str(empty))
        assert False, "expected FileNotFoundError for a directory with no .sql files"
    except FileNotFoundError as e:
        assert "nothing was scanned" in str(e)


def test_missing_directory_raises(tmp_path):
    """A misnamed or absent seed directory fails loudly rather than passing."""
    try:
        check_seed_sql.check_baseline_badges_stripped(str(tmp_path / "nope"))
        assert False, "expected FileNotFoundError for a missing directory"
    except FileNotFoundError:
        pass


# --- 09: enum and NULL checks, read by column name ---------------------------

_ZT_COLUMNS = (
    "id", "nistControlId", "pillars", "function", "maturityLevel",
    "createdById", "createdAt", "updatedAt",
)


def _zt_row(
    id_="'zt_x'",
    pillars="ARRAY['IDENTITY']::\"ZTPillar\"[]",
    function="'Access Management'",
    maturity="'TRADITIONAL'::\"ZTMaturityLevel\"",
):
    return {
        "id": id_,
        "nistControlId": "'ctrl_x'",
        "pillars": pillars,
        "function": function,
        "maturityLevel": maturity,
        "reviewFrequency": "'Annually'",
        "createdById": "'system_nist_gov'",
        "createdAt": "NOW()",
        "updatedAt": "NOW()",
    }


def _zt_sql(rows, columns=_ZT_COLUMNS):
    """09 as the overlay generator writes it: a column list, then one value per line."""
    header = (
        'INSERT INTO "ZeroTrustMapping" (\n'
        + ",\n".join(f'  "{c}"' for c in columns)
        + "\n)\nVALUES\n"
    )
    body = ",\n".join(
        "  (\n" + ",\n".join(f"    {row[c]}" for c in columns) + "\n  )" for row in rows
    )
    return header + body + ";\n"


def _zt_file(tmp_path, rows, columns=_ZT_COLUMNS):
    p = tmp_path / "09-zt-mappings.sql"
    p.write_text(_zt_sql(rows, columns))
    return str(p)


def test_zt_mappings_clean_rows_pass(tmp_path):
    rows = [_zt_row(), _zt_row(id_="'zt_y'", pillars="ARRAY['DATA', 'NETWORKS']::\"ZTPillar\"[]")]
    found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, rows))
    assert errors == []
    assert len(found) == 2


@pytest.mark.parametrize(
    "row, message",
    [
        (_zt_row(pillars="ARRAY['PLANETS']::\"ZTPillar\"[]"), "invalid pillar value 'PLANETS'"),
        (_zt_row(pillars="ARRAY['IDENTITY', 'PLANETS']::\"ZTPillar\"[]"), "invalid pillar value 'PLANETS'"),
        (_zt_row(pillars="ARRAY[]::\"ZTPillar\"[]"), "missing or unparseable pillars array"),
        (_zt_row(maturity="'LEGENDARY'::\"ZTMaturityLevel\""), "invalid maturity 'LEGENDARY'"),
        (_zt_row(maturity="NULL"), "NULL maturityLevel"),
        (_zt_row(function="NULL"), "NULL function"),
    ],
    ids=["invalid-pillar", "invalid-second-pillar", "empty-pillars", "invalid-maturity",
         "null-maturity", "null-function"],
)
def test_zt_mappings_broken_row_is_reported(tmp_path, row, message):
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [row]))
    assert len(errors) >= 1
    assert any(message in e for e in errors), errors


def test_zt_mappings_reads_by_column_name_not_position(tmp_path):
    """A column added ahead of maturityLevel must not shift the checks onto it.

    The positional read this replaced checked a dropped column's line long after the
    column was gone. Here a column sits between function and maturityLevel, and the
    invalid maturity is still the value reported."""
    columns = ("id", "nistControlId", "pillars", "function", "reviewFrequency",
               "maturityLevel", "createdById", "createdAt", "updatedAt")
    clean = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [_zt_row()], columns))
    assert clean[1] == []
    broken = _zt_row(maturity="'LEGENDARY'::\"ZTMaturityLevel\"")
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [broken], columns))
    assert any("invalid maturity 'LEGENDARY'" in e for e in errors), errors


def test_zt_mappings_missing_required_column_fails(tmp_path):
    columns = tuple(c for c in _ZT_COLUMNS if c != "maturityLevel")
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [_zt_row()], columns))
    assert errors == ["  column list is missing maturityLevel"]


def test_zt_mappings_row_with_wrong_value_count_fails(tmp_path):
    sql = _zt_sql([_zt_row()]).replace("    'system_nist_gov',\n", "")
    p = tmp_path / "09-zt-mappings.sql"
    p.write_text(sql)
    _found, errors = check_seed_sql.check_zt_mappings(str(p))
    assert errors == ["  'zt_x': 7 values for 8 columns"]


def test_zt_mappings_without_insert_header_fails(tmp_path):
    p = tmp_path / "09-zt-mappings.sql"
    p.write_text("-- no rows\n")
    _found, errors = check_seed_sql.check_zt_mappings(str(p))
    assert len(errors) == 1
    assert "no INSERT INTO" in errors[0]


def test_zt_mappings_with_a_header_and_no_rows_fails(tmp_path):
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, []))
    assert errors == ["  no rows after the column list"]


# One row written on one line, as a generator in another shape might write it. Its
# invalid maturity must not pass unread.
_ONE_LINE_ROW = (
    "  ('zt_y', 'ctrl_y', ARRAY['IDENTITY']::\"ZTPillar\"[], 'Access Management', "
    "'LEGENDARY'::\"ZTMaturityLevel\", 'system_nist_gov', NOW(), NOW())"
)


def test_zt_mappings_row_on_one_line_fails(tmp_path):
    p = tmp_path / "09-zt-mappings.sql"
    p.write_text(_zt_sql([]).replace(";\n", _ONE_LINE_ROW + ";\n"))
    _found, errors = check_seed_sql.check_zt_mappings(str(p))
    assert errors == ["  1 of 1 row(s) are not written one value per line"]


def test_zt_mappings_one_line_row_among_others_fails(tmp_path):
    p = tmp_path / "09-zt-mappings.sql"
    p.write_text(_zt_sql([_zt_row()]).replace(";\n", ",\n" + _ONE_LINE_ROW + ";\n"))
    found, errors = check_seed_sql.check_zt_mappings(str(p))
    assert len(found) == 1
    assert errors == ["  1 of 2 row(s) are not written one value per line"]


@pytest.mark.parametrize("column", ["id", "nistControlId", "createdById"])
def test_zt_mappings_null_in_a_not_null_column_is_reported(tmp_path, column):
    row = {**_zt_row(), column: "NULL"}
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [row]))
    assert any(f"NULL {column} (NOT NULL column)" in e for e in errors), errors


def test_zt_mappings_null_catalog_key_is_reported_on_either_line(tmp_path):
    """One line keys mappings by nistControlId, the other by arsControlId."""
    columns = tuple("arsControlId" if c == "nistControlId" else c for c in _ZT_COLUMNS)
    row = {**_zt_row(), "arsControlId": "NULL"}
    _found, errors = check_seed_sql.check_zt_mappings(_zt_file(tmp_path, [row], columns))
    assert any("NULL arsControlId (NOT NULL column)" in e for e in errors), errors


# A column between function and maturityLevel. The coverage check used to find these
# two side by side with a pattern, so this layout made it read nothing and pass 0 of 0.
_REORDERED = ("id", "nistControlId", "pillars", "function", "reviewFrequency",
              "maturityLevel", "createdById", "createdAt", "updatedAt")


def test_guidance_coverage_reads_09_by_column_name(tmp_path):
    mappings = _zt_sql([_zt_row(), _zt_row(id_="'zt_y'", function="'Identity Stores'")], _REORDERED)
    guidance = _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
    m, g = tmp_path / "09.sql", tmp_path / "12.sql"
    m.write_text(mappings)
    g.write_text(guidance)
    resolved, total, gaps, _near, _orphans = check_seed_sql.check_guidance_coverage(str(m), str(g))
    assert (resolved, total) == (1, 2)
    assert gaps == [("IDENTITY", "Identity Stores")]


# --- 12: guidance row integrity ----------------------------------------------


def _guidance_file(tmp_path, guidance_sql):
    p = tmp_path / "12.sql"
    p.write_text(guidance_sql)
    return str(p)


def test_guidance_integrity_clean_rows_pass(tmp_path):
    g = (
        _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
        + _guidance("data.logging", "DATA", "Data Logging", "Data Logging")
    )
    assert check_seed_sql.check_guidance_integrity(_guidance_file(tmp_path, g)) == []


@pytest.mark.parametrize(
    "guidance_sql, message",
    [
        (
            _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
            + _guidance("identity.access", "IDENTITY", "Identity Stores", "Identity Stores"),
            "duplicate id 'identity.access'",
        ),
        (
            _guidance("data.access", "IDENTITY", "Access Management", "Access Management"),
            "should start with 'identity.'",
        ),
        (
            _guidance("identity.access", "IDENTITY", "Access Management", "Access Management", base=""),
            "empty base for 'Access Management'",
        ),
        (
            _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
            + _guidance("identity.access-2", "IDENTITY", "Access Managment", "Access Managment"),
            "near-duplicate functionGroup under IDENTITY",
        ),
    ],
    ids=["duplicate-id", "wrong-prefix", "empty-base", "near-duplicate-group"],
)
def test_guidance_integrity_broken_row_is_reported(tmp_path, guidance_sql, message):
    errors = check_seed_sql.check_guidance_integrity(_guidance_file(tmp_path, guidance_sql))
    assert any(message in e for e in errors), errors


# --- 07: parameter numbered-list bleed ---------------------------------------


def _params_file(tmp_path, text):
    p = tmp_path / "07-control-parameters.sql"
    p.write_text(text)
    return str(p)


def test_param_bleed_clean_values_pass(tmp_path):
    """A real value ending in a number and a period is not list bleed."""
    p = _params_file(tmp_path, "  ('param_x', 'Retain for 30. days', 'at least 90 days'),\n")
    assert check_seed_sql.check_param_numbering_bleed(p) == []


def test_param_bleed_inline_list_item_is_reported(tmp_path):
    p = _params_file(tmp_path, "  ('param_x', 'review accounts 1. reauthorize 2. remove'),\n")
    hits = check_seed_sql.check_param_numbering_bleed(p)
    assert len(hits) == 2
    assert "reauthorize" in hits[0]


def test_param_bleed_trailing_list_marker_is_reported(tmp_path):
    p = _params_file(tmp_path, "  ('param_x', 'disable the account 2.'),\n")
    assert len(check_seed_sql.check_param_numbering_bleed(p)) == 1


# --- 06: part label convention -----------------------------------------------


def _part(label):
    return f"  ('part_x', 'x_smt', {label}, 'item', 'Do the thing.', 0, NULL, 'ctrl_x'),\n"


def _parts_file(tmp_path, labels):
    p = tmp_path / "06-control-parts.sql"
    p.write_text("".join(_part(label) for label in labels))
    return str(p)


def test_part_labels_in_every_known_shape_pass(tmp_path):
    p = _parts_file(tmp_path, ["NULL", "'a'", "'a.'", "'12'", "'12.'", "'(a)'", "'[1]'"])
    assert check_seed_sql.check_part_label_convention(p) == {}


def test_part_labels_outside_the_known_shapes_are_counted(tmp_path):
    p = _parts_file(tmp_path, ["'a.'", "'a)'", "'b)'", "'a)'", "'1-'"])
    assert check_seed_sql.check_part_label_convention(p) == {"a)": 2, "b)": 1, "1-": 1}


# --- 04: discussion link markup ----------------------------------------------


def _controls_file(tmp_path, text):
    p = tmp_path / "04-controls.sql"
    p.write_text(text)
    return str(p)


def test_discussion_markdown_links_are_counted_as_handled(tmp_path):
    p = _controls_file(tmp_path, "'See [AC-3](#ac-3) and [the guide](https://example.com/guide).'\n")
    assert check_seed_sql.check_discussion_markup(p) == (2, [])


@pytest.mark.parametrize(
    "text, message",
    [
        ('See HYPERLINK "https://example.com/guide" for more.', "1 HYPERLINK formula(s)"),
        ('See <a href="https://example.com/guide">the guide</a>.', "1 HTML anchor(s)"),
        ('See =HYPERLINK("https://example.com/guide", "the guide").', "1 Excel =HYPERLINK(label) form(s)"),
    ],
    ids=["hyperlink-formula", "html-anchor", "excel-hyperlink"],
)
def test_discussion_link_forms_the_modal_renders_raw_are_reported(tmp_path, text, message):
    _handled, unhandled = check_seed_sql.check_discussion_markup(_controls_file(tmp_path, text))
    assert unhandled == [message]


# --- main(): every check reaches the exit code -------------------------------
#
# The tests above prove each check finds its defect. These prove the script exits 1
# when it does: a check whose finding is printed but never fails the run measures
# nothing. Each case runs the script against a seed directory that is clean except
# for one defect.

_CLEAN_SEED = {
    "04-controls.sql": "'See [AC-3](#ac-3).'\n",
    "06-control-parts.sql": _part("'a.'"),
    "07-control-parameters.sql": "-- Intentionally empty.\n",
    "09-zt-mappings.sql": _zt_sql([_zt_row()]),
    "12-ztmm-guidance-updated.sql": _guidance(
        "identity.access", "IDENTITY", "Access Management", "Access Management"
    ),
}


def _run_checker(tmp_path, files):
    seed_dir = tmp_path / "app" / "prisma" / "seed-sql" / "fixture"
    seed_dir.mkdir(parents=True)
    for name, text in files.items():
        (seed_dir / name).write_text(text, encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(_MOD_PATH), "--catalog=fixture"],
        cwd=tmp_path, capture_output=True, text=True,
    )


def test_main_exits_zero_on_a_clean_seed(tmp_path):
    result = _run_checker(tmp_path, _CLEAN_SEED)
    assert result.returncode == 0, result.stdout


def test_main_exits_zero_on_a_backbone_only_seed(tmp_path):
    """A catalog seeded without the Zero Trust overlay is valid; the overlay checks skip."""
    backbone = {k: v for k, v in _CLEAN_SEED.items() if not k.startswith(("09", "12"))}
    result = _run_checker(tmp_path, backbone)
    assert result.returncode == 0, result.stdout
    assert "skipping the overlay checks" in result.stdout


@pytest.mark.parametrize(
    "name, text, marker",
    [
        ("06-control-parts.sql", _part("'a)'"), "are not a marker shape"),
        ("04-controls.sql", "'Retain records for \U0001F13B: 30 days.'\n", "baseline badge glyph(s) survived"),
        (
            "09-zt-mappings.sql",
            _zt_sql([_zt_row(maturity="'LEGENDARY'::\"ZTMaturityLevel\"")]),
            "invalid maturity 'LEGENDARY'",
        ),
        (
            "09-zt-mappings.sql",
            _zt_sql([_zt_row()], tuple(c for c in _ZT_COLUMNS if c != "pillars")),
            "column list is missing pillars",
        ),
        ("09-zt-mappings.sql", _zt_sql([]), "no mappings were read from 09"),
        ("09-zt-mappings.sql", _zt_sql([]).replace(";\n", _ONE_LINE_ROW + ";\n"), "not written one value per line"),
        (
            "09-zt-mappings.sql",
            _zt_sql([_zt_row(), _zt_row(id_="'zt_y'", function="'Identity Stores'")], _REORDERED),
            "1 of 2 mapping(s) resolve to no guidance row",
        ),
        ("09-zt-mappings.sql", _zt_sql([_zt_row(function="'Access & Management'")]), "use 'and', not '&'"),
        (
            "12-ztmm-guidance-updated.sql",
            _guidance("identity.stores", "IDENTITY", "Identity Stores", "Identity Stores"),
            "resolve to no guidance row",
        ),
        (
            "12-ztmm-guidance-updated.sql",
            _guidance("identity.access", "IDENTITY", "Access Management Capability", "Access Management Capability"),
            "NEAR-MISS DRIFT",
        ),
        (
            "12-ztmm-guidance-updated.sql",
            _guidance("identity.access", "IDENTITY", "Access Management", "Access Management")
            + _guidance("identity.access", "IDENTITY", "Identity Stores", "Identity Stores"),
            "duplicate id 'identity.access'",
        ),
        ("07-control-parameters.sql", "  ('param_x', 'review accounts 1. reauthorize'),\n", "numbered-list bleed"),
        ("04-controls.sql", "'See HYPERLINK \"https://example.com/guide\".'\n", "link markup the modal would render raw"),
    ],
    ids=["part-label", "badge-glyph", "invalid-maturity", "missing-column", "header-only",
         "one-line-row", "reordered-columns", "ampersand", "guidance-gap", "near-miss-drift",
         "guidance-integrity", "param-bleed", "discussion-markup"],
)
def test_main_exits_one_on_each_defect(tmp_path, name, text, marker):
    """Each case must fail through its own check, not through a crash: an uncaught
    exception also exits 1, so the case asserts the check's message and no traceback."""
    result = _run_checker(tmp_path, {**_CLEAN_SEED, name: text})
    assert result.returncode == 1, result.stdout
    assert marker in result.stdout, result.stdout
    assert "Traceback" not in result.stdout + result.stderr, result.stderr


# --- main(): a missing seed file fails the run ------------------------------
#
# 04, 06 and 07 are backbone files every catalog seeds, overlay or not. A check that
# skips when its file is missing reports nothing about that file and lets the run
# pass, so each absence has to fail the run and name the file.

_BACKBONE_ONLY_SEED = {k: v for k, v in _CLEAN_SEED.items() if not k.startswith(("09", "12"))}


@pytest.mark.parametrize("seed", [_CLEAN_SEED, _BACKBONE_ONLY_SEED], ids=["overlay", "backbone-only"])
@pytest.mark.parametrize("name", ["04-controls.sql", "06-control-parts.sql", "07-control-parameters.sql"])
def test_main_fails_on_a_missing_backbone_file(tmp_path, seed, name):
    result = _run_checker(tmp_path, {k: v for k, v in seed.items() if k != name})
    assert result.returncode == 1, result.stdout
    assert f"{name} not found" in result.stdout, result.stdout
    assert "Traceback" not in result.stdout + result.stderr, result.stderr


def test_main_fails_on_missing_guidance_and_runs_every_later_check(tmp_path):
    """With 09 present the overlay is incomplete without 12. The run fails, and the
    checks after the guidance checks still run: the 07 defect planted here must be
    reported too, which it was not when a missing 12 ended the run."""
    files = {k: v for k, v in _CLEAN_SEED.items() if k != "12-ztmm-guidance-updated.sql"}
    files["07-control-parameters.sql"] = "  ('param_x', 'review accounts 1. reauthorize'),\n"
    result = _run_checker(tmp_path, files)
    assert result.returncode == 1, result.stdout
    assert "12-ztmm-guidance-updated.sql not found" in result.stdout, result.stdout
    assert "numbered-list bleed" in result.stdout, result.stdout
    assert "discussion links" in result.stdout, result.stdout
    assert "guidance row integrity OK" not in result.stdout, result.stdout
    assert "Traceback" not in result.stdout + result.stderr, result.stderr
