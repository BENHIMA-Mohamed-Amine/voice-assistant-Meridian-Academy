"""Deterministic unit tests for notify_support_team -- no LLM or network involved."""

import pytest

from agent.tools import notify_support_team


def _call(fn):
    """Unwrap the raw function behind the @function_tool decorator, if wrapped."""
    return getattr(fn, "__wrapped__", fn)


@pytest.mark.asyncio
async def test_rejects_personal_email_without_posting(monkeypatch) -> None:
    posted = False

    async def _fake_post(*_args, **_kwargs) -> None:
        nonlocal posted
        posted = True

    monkeypatch.setattr("agent.tools._post_to_slack", _fake_post)

    result = await _call(notify_support_team)(work_email="person@gmail.com")

    assert "Rejected" in result
    assert posted is False


@pytest.mark.asyncio
async def test_accepts_work_email_and_succeeds_without_webhook_configured(
    monkeypatch,
) -> None:
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)

    result = await _call(notify_support_team)(work_email="sam.rivera@acmerobotics.com")

    assert result == "success"
