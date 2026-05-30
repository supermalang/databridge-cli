from src.data.transform import load_data, export_data, load_processed_data


def test_load_data_populates_nested_repeats():
    submissions = [
        {"_id": 12, "region": "North",
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
              ]},
         ]},
    ]
    cfg = {"questions": [
        {"kobo_key": "region", "export_label": "Region", "category": "categorical"},
        {"kobo_key": "household/members/name", "export_label": "Name",
         "category": "qualitative", "group": "household/members", "repeat_group": "members"},
        {"kobo_key": "household/members/illnesses/type", "export_label": "Illness",
         "category": "qualitative", "group": "household/members/illnesses", "repeat_group": "illnesses"},
    ]}
    main_df, repeat_tables = load_data(submissions, cfg)

    assert list(main_df["Region"]) == ["North"]
    assert "household/members" in repeat_tables
    assert "household/members/illnesses" in repeat_tables
    illnesses = repeat_tables["household/members/illnesses"]
    assert list(illnesses["Illness"]) == ["flu"]
    assert list(illnesses["_root_id"]) == [12]
    assert list(illnesses["_parent_index"]) == [12]


def test_linkage_columns_survive_csv_roundtrip(tmp_path):
    submissions = [
        {"_id": 12,
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
              ]},
         ]},
    ]
    cfg = {
        "form": {"alias": "survey"},
        "export": {"format": "csv", "output_dir": str(tmp_path)},
        "questions": [
            {"kobo_key": "household/members/name", "export_label": "Name",
             "category": "qualitative", "group": "household/members", "repeat_group": "members"},
            {"kobo_key": "household/members/illnesses/type", "export_label": "Illness",
             "category": "qualitative", "group": "household/members/illnesses", "repeat_group": "illnesses"},
        ],
    }
    main_df, repeat_tables = load_data(submissions, cfg)
    export_data(main_df, cfg, repeat_tables)

    _, reloaded = load_processed_data(cfg)
    illnesses = reloaded["household_members_illnesses"]
    assert "_row_id" in illnesses.columns
    assert "_parent_row_id" in illnesses.columns
    assert list(illnesses["Illness"]) == ["flu"]
