from sqlalchemy import create_engine, inspect
from web.db.models import Base, User, Org, Membership, Project


def test_metadata_creates_all_tables_on_sqlite():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    names = set(inspect(engine).get_table_names())
    assert {"users", "orgs", "memberships", "projects"} <= names


def test_project_has_config_and_version_columns():
    cols = {c.name for c in Project.__table__.columns}
    assert {"id", "org_id", "name", "slug", "config", "config_version"} <= cols


def test_user_has_sub_and_active_project():
    cols = {c.name for c in User.__table__.columns}
    assert {"id", "zitadel_sub", "email", "name", "active_project_id"} <= cols
