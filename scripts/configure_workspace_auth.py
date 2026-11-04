#!/usr/bin/env python3
"""Create a private standalone workspace account config without logging its password."""

import argparse
import getpass
import hashlib
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path, help="config outside served/static directories")
    parser.add_argument("--origin", required=True, help="full HTTPS origin; HTTP only on loopback")
    parser.add_argument("--username", required=True)
    parser.add_argument("--owner-id", default="anonymous", help="existing resource owner ID")
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if not origin.hostname or origin.path or origin.query or origin.fragment or origin.username or origin.password or (
        origin.scheme != "https" and not (origin.scheme == "http" and origin.hostname in ("localhost", "127.0.0.1"))
    ):
        parser.error("use a complete HTTPS origin without a path, or HTTP on loopback")
    if not args.username or len(args.username) > 100 or not args.owner_id:
        parser.error("provide an account name and an owner ID")
    password = getpass.getpass("Workspace password (at least 14 characters): ")
    if not 14 <= len(password) <= 512 or not secrets.compare_digest(password.encode(), getpass.getpass("Repeat password: ").encode()):
        parser.error("passwords do not match or do not meet length requirements")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    fd = os.open(args.config, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump({"origin": args.origin, "username": args.username, "owner_id": args.owner_id,
                   "salt": salt.hex(), "password_hash": digest.hex()}, file)
        file.write("\n")
    print(f"Created workspace account configuration: {args.config}")


if __name__ == "__main__":
    main()
