"""Work-email vs. personal-email domain check."""

# Providers rejected as personal/free email accounts -- everything else is treated as a
# work email. This is a simple allowlist-by-exclusion, not a real domain verification.
PERSONAL_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "icloud.com",
        "aol.com",
        "protonmail.com",
        "live.com",
        "msn.com",
        "yandex.com",
    }
)


def is_work_email(email: str) -> bool:
    """Check whether an email address is a work (non-personal) address."""
    parts = email.split("@")
    if len(parts) < 2:
        return False
    domain = parts[1].lower()
    return domain not in PERSONAL_EMAIL_DOMAINS
