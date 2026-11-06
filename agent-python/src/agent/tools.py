"""The notify_support_team tool: posts a completed demo request to Slack."""

from __future__ import annotations

import asyncio
import logging
import os

import aiohttp
from livekit.agents import function_tool

from agent.email import is_work_email

logger = logging.getLogger("agent.tools")

# Keeps references to fire-and-forget Slack-notification tasks so they aren't
# garbage-collected mid-flight; each removes itself from this set when it finishes.
_background_tasks: set[asyncio.Task[None]] = set()


@function_tool
async def notify_support_team(
    work_email: str,
    company_name: str | None = None,
    service_interest: str | None = None,
) -> str:
    """Notify the support team that a visitor wants to book a demo.

    Only call this with values the visitor actually said, never a guessed or
    placeholder email -- if you don't have a real work email from the visitor yet,
    ask for it first.

    Only work email addresses are accepted, not personal ones (e.g. gmail.com,
    yahoo.com, outlook.com, hotmail.com, icloud.com). If this tool reports the email
    was rejected, tell the visitor only work emails are accepted and ask them to
    provide one instead.

    Args:
        work_email: The visitor's work email address. Required.
        company_name: The visitor's company name, if provided.
        service_interest: The training program the visitor is interested in, if provided.
    """
    if not is_work_email(work_email):
        return (
            "Rejected: that is a personal email address. Only work email addresses "
            "are accepted -- ask the visitor for their work email instead."
        )

    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        logger.warning("SLACK_WEBHOOK_URL is not set; skipping Slack notification.")
        return "success"

    lines = [
        "New demo request",
        f"Work email: {work_email}",
        f"Company: {company_name}" if company_name else None,
        f"Interested in: {service_interest}" if service_interest else None,
    ]
    text = "\n".join(line for line in lines if line is not None)

    # Fire-and-forget: the webhook call doesn't block the voice response. Reference
    # kept in _background_tasks until it finishes, so it isn't garbage-collected
    # mid-flight.
    task = asyncio.create_task(_post_to_slack(webhook_url, text))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return "success"


async def _post_to_slack(webhook_url: str, text: str) -> None:
    """Post a message to a Slack incoming webhook, logging (not raising) on failure."""
    try:
        async with (
            aiohttp.ClientSession() as session,
            session.post(webhook_url, json={"text": text}, timeout=aiohttp.ClientTimeout(total=10)),
        ):
            pass
    except Exception:
        logger.exception("Failed to notify Slack")
