# tests/test_flatten.py
from src.data.flatten import _dedup_labels


def test_dedup_labels_suffixes_duplicates_in_order():
    assert _dedup_labels(["Region", "Region", "Age", "Region"]) == [
        "Region", "Region_1", "Age", "Region_2",
    ]


def test_dedup_labels_leaves_unique_untouched():
    assert _dedup_labels(["A", "B", "C"]) == ["A", "B", "C"]
