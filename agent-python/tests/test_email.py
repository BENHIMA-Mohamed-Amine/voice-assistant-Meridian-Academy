from agent.email import is_work_email


def test_accepts_work_domain() -> None:
    assert is_work_email("sam.rivera@acmerobotics.com") is True


def test_rejects_each_personal_domain() -> None:
    for domain in (
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
    ):
        assert is_work_email(f"person@{domain}") is False


def test_is_case_insensitive_on_domain() -> None:
    assert is_work_email("person@GMAIL.COM") is False
    assert is_work_email("person@AcmeRobotics.com") is True


def test_rejects_missing_at_sign() -> None:
    assert is_work_email("not-an-email") is False
