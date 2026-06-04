"""First-login provisioning: upsert user + personal org + owner membership,
apply the SUPERADMIN_EMAILS bootstrap, and consume any pending project invites."""
import os

from sqlalchemy.orm import Session

from web.db import repository as repo

DEV_CLAIMS = {"sub": "dev-local", "email": "dev@localhost", "name": "Local Dev"}


def superadmin_emails() -> list:
    """Emails (lower-cased) configured as superadmins via the SUPERADMIN_EMAILS env var."""
    raw = os.environ.get("SUPERADMIN_EMAILS", "")
    return [e.strip().lower() for e in raw.split(",") if e.strip()]


def ensure_user(db: Session, claims: dict) -> repo.User:
    """Idempotent: upsert the user; if they have no org, create a personal one;
    flag superadmins from env; and turn any pending invites into memberships."""
    user = repo.upsert_user(db, sub=claims["sub"],
                            email=claims.get("email", ""), name=claims.get("name", ""))
    if not repo._user_org_ids(db, user):
        base = (claims.get("email", "") or claims["sub"]).split("@")[0]
        org = repo.create_org(db, name=f"{base} (personal)", slug=base, owner=user)
        repo.add_membership(db, user=user, org=org, role="owner")
    # Superadmin bootstrap from env (sticks on first login).
    if user.email and user.email.lower() in superadmin_emails() and not user.is_superadmin:
        user.is_superadmin = True
        db.commit()
    # Pending invites (matched by email) → ProjectMemberships.
    repo.consume_invitations_for(db, user)
    return user


def ensure_dev_user(db: Session) -> repo.User:
    return ensure_user(db, DEV_CLAIMS)
