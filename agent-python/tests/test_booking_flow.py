"""End-to-end eval: the agent collects company/email/program, then books the demo."""

import pytest
from dotenv import load_dotenv
from livekit.agents import AgentSession, inference

from agent.agent import create_agent
from providers.llm import create_llm

load_dotenv(".env.local")


@pytest.mark.asyncio
async def test_books_demo_with_work_email() -> None:
    """Collects company, work email, and program, then calls notify_support_team."""
    async with (
        inference.LLM(model="openai/gpt-4.1-mini") as judge_llm,
        AgentSession(llm=create_llm()) as session,
    ):
        await session.start(create_agent(lambda: False, lambda: 0.6))

        await session.run(user_input="Hi, I'd like to book a demo")
        await session.run(user_input="I'm from Acme Robotics")
        await session.run(user_input="My work email is sam.rivera@acmerobotics.com")
        result = await session.run(user_input="I'm interested in Corporate Training")

        fnc_call = result.expect.next_event().is_function_call(name="notify_support_team")
        assert fnc_call.event().item.arguments["work_email"] == "sam.rivera@acmerobotics.com"

        result.expect.next_event().is_function_call_output()

        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                judge_llm,
                intent=(
                    "Confirms in roughly one sentence that the support team has been "
                    "notified and will follow up at the email provided."
                ),
            )
        )


@pytest.mark.asyncio
async def test_rejects_personal_email() -> None:
    """Rejects a personal email domain instead of booking with it."""
    async with (
        inference.LLM(model="openai/gpt-4.1-mini") as judge_llm,
        AgentSession(llm=create_llm()) as session,
    ):
        await session.start(create_agent(lambda: False, lambda: 0.6))

        await session.run(user_input="I'd like to book a demo")
        result = await session.run(user_input="My email is jamie.chen@gmail.com")

        await (
            result.expect.next_event()
            .is_message(role="assistant")
            .judge(
                judge_llm,
                intent=(
                    "Tells the visitor that personal email addresses are not accepted "
                    "and asks for a work email instead, without booking the demo."
                ),
            )
        )
