"""Shared fixtures for kobo-reporter tests."""
from copy import deepcopy
import pytest


@pytest.fixture
def kobo_asset():
    """A small but realistic Kobo asset schema: 1 main group + 1 repeat group."""
    return {
        "content": {
            "survey": [
                {"type": "text", "name": "respondent_name", "label": "Respondent name"},
                {"type": "begin_group", "name": "demographics"},
                {"type": "select_one regions", "name": "region", "label": "Region"},
                {"type": "integer", "name": "age", "label": "Age"},
                {"type": "end_group"},
                {"type": "begin_repeat", "name": "household_members"},
                {"type": "text", "name": "member_name", "label": "Name"},
                {"type": "select_multiple skills", "name": "skills", "label": "Skills"},
                {"type": "end_repeat"},
            ],
            "choices": [
                {"list_name": "regions", "name": "north", "label": "North"},
                {"list_name": "regions", "name": "south", "label": "South"},
                {"list_name": "skills", "name": "cook", "label": "Cooking"},
                {"list_name": "skills", "name": "farm", "label": "Farming"},
            ],
        }
    }


@pytest.fixture
def submissions():
    """Sample submissions matching kobo_asset: 2 respondents with repeat-group rows."""
    return [
        {
            "_id": 1,
            "respondent_name": "Alice",
            "demographics/region": "north",
            "demographics/age": 30,
            "household_members": [
                {"household_members/member_name": "Bob", "household_members/skills": "cook farm"},
                {"household_members/member_name": "Carol", "household_members/skills": "cook"},
            ],
        },
        {
            "_id": 2,
            "respondent_name": "Dave",
            "demographics/region": "south",
            "demographics/age": 45,
            "household_members": [
                {"household_members/member_name": "Eve", "household_members/skills": "farm"},
            ],
        },
    ]


@pytest.fixture
def config():
    """Sample config matching the asset + submissions fixtures.

    Tests can deepcopy and mutate.
    """
    return deepcopy({
        "api": {"platform": "kobo", "url": "https://example.test/api/v2", "token": "test-token"},
        "form": {"uid": "TESTFORM", "alias": "test"},
        "questions": [
            {"kobo_key": "respondent_name", "label": "Respondent name", "type": "text",
             "category": "qualitative", "group": "", "choice_list": None,
             "export_label": "Respondent", "repeat_group": None, "choices": None},
            {"kobo_key": "demographics/region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "demographics", "choice_list": "regions",
             "export_label": "Region", "repeat_group": None,
             "choices": {"north": "North", "south": "South"}},
            {"kobo_key": "demographics/age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "demographics", "choice_list": None,
             "export_label": "Age", "repeat_group": None, "choices": None},
            {"kobo_key": "household_members/member_name", "label": "Name", "type": "text",
             "category": "qualitative", "group": "household_members", "choice_list": None,
             "export_label": "Member name", "repeat_group": "household_members", "choices": None},
            {"kobo_key": "household_members/skills", "label": "Skills", "type": "select_multiple",
             "category": "categorical", "group": "household_members", "choice_list": "skills",
             "export_label": "Skills", "repeat_group": "household_members",
             "choices": {"cook": "Cooking", "farm": "Farming"}},
        ],
        "filters": [],
        "computed_columns": [],
        "views": [],
        "export": {"format": "csv", "output_dir": "data/processed"},
    })
