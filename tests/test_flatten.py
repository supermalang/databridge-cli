# tests/test_flatten.py
from src.data.flatten import _dedup_labels


def test_dedup_labels_suffixes_duplicates_in_order():
    assert _dedup_labels(["Region", "Region", "Age", "Region"]) == [
        "Region", "Region_1", "Age", "Region_2",
    ]


def test_dedup_labels_leaves_unique_untouched():
    assert _dedup_labels(["A", "B", "C"]) == ["A", "B", "C"]


from src.data.flatten import _parent_repeat


def test_parent_repeat_top_level_has_no_parent():
    paths = ["household/members", "household/members/illnesses"]
    assert _parent_repeat("household/members", paths) is None


def test_parent_repeat_returns_nearest_ancestor():
    paths = ["household/members", "household/members/illnesses"]
    assert _parent_repeat("household/members/illnesses", paths) == "household/members"


def test_parent_repeat_picks_longest_prefix():
    paths = ["a", "a/b", "a/b/c"]
    assert _parent_repeat("a/b/c", paths) == "a/b"


from src.data.flatten import _resolve_array, _read_field


def test_resolve_array_matches_full_path_key():
    container = {"household/members": [{"x": 1}]}
    assert _resolve_array(container, "household/members", "household/members") == [{"x": 1}]


def test_resolve_array_matches_relative_key():
    member = {"members/illnesses": [{"t": "flu"}]}
    assert _resolve_array(member, "household/members/illnesses", "illnesses") == [{"t": "flu"}]


def test_resolve_array_matches_leaf_key():
    member = {"illnesses": [{"t": "flu"}]}
    assert _resolve_array(member, "household/members/illnesses", "illnesses") == [{"t": "flu"}]


def test_resolve_array_returns_none_when_absent():
    assert _resolve_array({"other": 1}, "a/b", "b") is None


def test_read_field_tries_full_then_relative_then_leaf():
    q = {"kobo_key": "household/members/name"}
    assert _read_field({"household/members/name": "A"}, q) == "A"
    assert _read_field({"members/name": "B"}, q) == "B"
    assert _read_field({"name": "C"}, q) == "C"
    assert _read_field({"other": "Z"}, q) is None


from src.data.flatten import build_repeat_tables


def _single_level_fixture():
    submissions = [
        {"_id": 12, "region": "North",
         "household/members": [
             {"household/members/name": "A", "household/members/age": 30},
             {"household/members/name": "B", "household/members/age": 5},
         ]},
        {"_id": 13, "region": "South", "household/members": []},
    ]
    repeat_groups = {
        "household/members": [
            {"kobo_key": "household/members/name", "export_label": "Name", "category": "qualitative"},
            {"kobo_key": "household/members/age", "export_label": "Age", "category": "quantitative"},
        ]
    }
    return submissions, repeat_groups


def test_build_repeat_tables_single_level_rows_and_values():
    submissions, repeat_groups = _single_level_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    members = tables["household/members"]
    assert len(members) == 2
    assert list(members["Name"]) == ["A", "B"]
    assert list(members["Age"]) == [30, 5]


def test_build_repeat_tables_single_level_linkage_matches_root_id():
    submissions, repeat_groups = _single_level_fixture()
    members = build_repeat_tables(submissions, repeat_groups)["household/members"]
    assert list(members["_parent_index"]) == [12, 12]
    assert list(members["_root_id"]) == [12, 12]
    assert list(members["_parent_row_id"]) == [12, 12]
    assert list(members["_row_id"]) == ["12.0", "12.1"]
    assert list(members["_row_index"]) == [0, 1]


def _nested_fixture():
    submissions = [
        {"_id": 12,
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
                  {"household/members/illnesses/type": "cold"},
              ]},
             {"household/members/name": "B",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "fever"},
              ]},
         ]},
    ]
    repeat_groups = {
        "household/members": [
            {"kobo_key": "household/members/name", "export_label": "Name", "category": "qualitative"},
        ],
        "household/members/illnesses": [
            {"kobo_key": "household/members/illnesses/type", "export_label": "Illness", "category": "qualitative"},
        ],
    }
    return submissions, repeat_groups


def test_nested_subrepeat_is_populated_not_empty():
    submissions, repeat_groups = _nested_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    illnesses = tables["household/members/illnesses"]
    assert len(illnesses) == 3
    assert list(illnesses["Illness"]) == ["flu", "cold", "fever"]


def test_nested_subrepeat_links_to_immediate_parent_and_root():
    submissions, repeat_groups = _nested_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    members = tables["household/members"]
    illnesses = tables["household/members/illnesses"]
    assert list(members["_row_id"]) == ["12.0", "12.1"]
    assert list(illnesses["_parent_row_id"]) == ["12.0", "12.0", "12.1"]
    assert list(illnesses["_row_id"]) == ["12.0.0", "12.0.1", "12.1.0"]
    assert list(illnesses["_root_id"]) == [12, 12, 12]
    joined = illnesses.merge(members[["_row_id", "Name"]],
                             left_on="_parent_row_id", right_on="_row_id",
                             suffixes=("", "_member"))
    assert list(joined["Name"]) == ["A", "A", "B"]
