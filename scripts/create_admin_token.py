"""Explicitly provision a local runtime admin and print a short-lived bearer token.

Run only on a trusted server with its configured environment. Output is a credential.
No password login route is provided by this runtime. Existing non-admin accounts
are never promoted implicitly.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--expires-minutes", type=int, default=30)
    args = parser.parse_args()
    if not 1 <= args.expires_minutes <= 60:
        parser.error("Token lifetime must be between 1 and 60 minutes")
    import jwt
    from app.config import settings
    from app.db.models.user import User
    from app.db.session import SessionLocal
    if settings.DEV_MODE and settings.SKIP_AUTH and not settings.is_production:
        parser.error("Configure authentication and a random SECURITY_SECRET_KEY before provisioning")
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == args.username).first()
        if user is None:
            user = User(username=args.username, email=args.email, hashed_password="!",
                        is_active=True, is_superuser=True)
            db.add(user)
            db.commit()
            db.refresh(user)
        if not user.is_superuser or not user.is_active:
            parser.error("Existing account is inactive or is not an administrator")
        now = datetime.now(timezone.utc)
        token = jwt.encode({"user_id": user.id, "iat": now, "exp": now + timedelta(minutes=args.expires_minutes)},
                           settings.security.SECRET_KEY, algorithm=settings.security.ALGORITHM)
        print(token)


if __name__ == "__main__":
    main()
