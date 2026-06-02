"""First-login provisioning: upsert user + personal org + owner membership."""
from sqlalchemy.orm import Session

from web.db import repository as repo

DEV_CLAIMS = {"sub": "dev-local", "email": "dev@localhost", "name": "Local Dev"}


def ensure_user(db: Session, claims: dict) -> repo.User:
    """Idempotent: upsert the user; if they have no org, create a personal one."""
    user = repo.upsert_user(db, sub=claims["sub"],
                            email=claims.get("email", ""), name=claims.get("name", ""))
    if not repo._user_org_ids(db, user):
        base = (claims.get("email", "") or claims["sub"]).split("@")[0]
        org = repo.create_org(db, name=f"{base} (personal)", slug=base, owner=user)
        repo.add_membership(db, user=user, org=org, role="owner")
    return user


def ensure_dev_user(db: Session) -> repo.User:
    return ensure_user(db, DEV_CLAIMS)
