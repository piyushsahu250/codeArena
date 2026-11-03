"""Password hashing and signed access tokens, built from the standard library so you can see how they work.

In a production system use a reviewed library for tokens (for example PyJWT) instead of your own code.
"""
import base64
import hashlib
import hmac
import json
import os

ITERATIONS = 200_000


class TokenError(Exception):
    pass


def hash_password(password, iterations=ITERATIONS):
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        scheme, iterations, salt, digest = stored.split("$")
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
    except ValueError:
        return False
    return scheme == "pbkdf2_sha256" and hmac.compare_digest(candidate.hex(), digest)


def _encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(secret, payload):
    return _encode(hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def sign(secret, subject, expires_at):
    """Token = base64url(JSON payload) + '.' + base64url(HMAC-SHA256 of the payload). Anyone can read it; only the secret can sign it."""
    payload = _encode(json.dumps({"sub": subject, "exp": expires_at}, separators=(",", ":")).encode("utf-8"))
    return f"{payload}.{_signature(secret, payload)}"


def verify(secret, token, now):
    """Return the subject of a valid token, or raise TokenError."""
    try:
        payload, signature = token.split(".")
        if not hmac.compare_digest(signature, _signature(secret, payload)):
            raise TokenError("invalid token")
        claims = json.loads(_decode(payload))
        subject, expires_at = claims["sub"], claims["exp"]
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise TokenError("invalid token") from None
    if now >= expires_at:
        raise TokenError("token expired")
    return subject
