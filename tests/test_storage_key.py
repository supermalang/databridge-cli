from web.storage.base import storage_key, CATEGORIES, Storage


def test_storage_key_layout():
    assert storage_key("org1", "proj1", "reports", "r.docx") == \
        "orgs/org1/projects/proj1/reports/r.docx"


def test_storage_key_preserves_nested_name():
    assert storage_key("o", "p", "charts", "sub/c.png") == \
        "orgs/o/projects/p/charts/sub/c.png"


def test_categories_present():
    assert {"raw", "processed", "charts", "reports", "templates"} <= set(CATEGORIES)


def test_storage_is_abstract():
    import pytest
    with pytest.raises(TypeError):
        Storage()
