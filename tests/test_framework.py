from src.utils.framework import build_tree, find_node, enumerate_nodes, validate_refs


def _sample_cfg():
    return {
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [
                {"id": "OC1", "label": "Outcome 1", "parent": "GOAL"},
                {"id": "OC2", "label": "Outcome 2", "parent": "GOAL"},
            ],
            "outputs":  [
                {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
                {"id": "OP1.2", "label": "Output 1.2", "parent": "OC1"},
                {"id": "OP2.1", "label": "Output 2.1", "parent": "OC2"},
            ],
        },
        "indicators": [
            {"name": "ind_a", "framework_ref": "OP1.1"},
            {"name": "ind_b", "framework_ref": "OP1.2"},
            {"name": "ind_c", "framework_ref": "OC2"},
            {"name": "ind_d", "framework_ref": "MISSING"},
            {"name": "ind_e"},  # no framework_ref
        ],
    }


def test_build_tree_returns_none_without_framework_block():
    assert build_tree({}) is None


def test_build_tree_returns_nested_structure():
    tree = build_tree(_sample_cfg())
    assert tree["id"] == "GOAL"
    assert tree["label"] == "Reduce X"
    assert len(tree["children"]) == 2  # two outcomes
    assert tree["children"][0]["id"] == "OC1"
    assert len(tree["children"][0]["children"]) == 2  # OP1.1 + OP1.2


def test_find_node_returns_node_by_id():
    cfg = _sample_cfg()
    node = find_node(cfg, "OP1.2")
    assert node["label"] == "Output 1.2"
    assert node["level"] == "output"


def test_find_node_returns_none_for_missing_id():
    assert find_node(_sample_cfg(), "DOES_NOT_EXIST") is None


def test_enumerate_nodes_returns_flat_list_with_breadcrumbs():
    nodes = enumerate_nodes(_sample_cfg())
    # 1 goal + 2 outcomes + 3 outputs = 6 nodes
    assert len(nodes) == 6
    op11 = next(n for n in nodes if n["id"] == "OP1.1")
    assert op11["breadcrumb"] == "Reduce X › Outcome 1 › Output 1.1"
    assert op11["level"] == "output"


def test_validate_refs_returns_orphans_only():
    orphans = validate_refs(_sample_cfg())
    # Only ind_d references MISSING which is not in the framework
    assert len(orphans) == 1
    assert orphans[0]["indicator"] == "ind_d"
    assert orphans[0]["ref"] == "MISSING"


def test_validate_refs_empty_when_no_framework():
    cfg = {"indicators": [{"name": "x", "framework_ref": "Q"}]}
    # No framework block → can't validate references, return [] (single-mode safe)
    assert validate_refs(cfg) == []
