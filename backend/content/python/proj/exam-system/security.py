"""Password hashing with the standard library (PBKDF2-HMAC-SHA256, a random salt per password)."""
import hashlib
import hmac
import os

ITERATIONS = 200_000


def hash_password(password, iterations=ITERATIONS, salt=None):
    """Return 'pbkdf2_sha256$iterations$salt$hash'. The same password gives a different result every time (random salt)."""
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        scheme, iterations, salt, digest = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
    except ValueError:
        return False
    return hmac.compare_digest(candidate.hex(), digest)  # constant-time comparison
