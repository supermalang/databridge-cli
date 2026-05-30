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
