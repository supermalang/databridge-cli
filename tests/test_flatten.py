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
