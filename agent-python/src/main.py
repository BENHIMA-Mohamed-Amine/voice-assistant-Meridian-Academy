"""Entrypoint. Drives the voice pipeline through the VoicePipeline strategy from
providers/, so this file never branches on which architecture (cascade vs.
speech-to-speech) is active -- see providers/base.py and providers/pipeline.py."""

from __future__ import annotations

from pathlib import Path

# Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET when running
# locally or self-hosting your agent server.
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env.local")

from livekit.agents import (  # noqa: E402
    AgentServer,
    JobContext,
    JobProcess,
    UserInputTranscribedEvent,
    cli,
)

from agent.agent import create_agent  # noqa: E402
from agent.audio_quality import DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD  # noqa: E402
from providers.factory import create_pipeline  # noqa: E402
from signals.confidence_threshold_signal import watch_confidence_threshold  # noqa: E402
from signals.latency_metrics import publish_latency_metrics  # noqa: E402
from signals.noise_signal import watch_noise_signal  # noqa: E402
from signals.tracing import setup_langfuse_tracing  # noqa: E402
from signals.turn_pairing import publish_turn_pairing  # noqa: E402

server = AgentServer(
    # `lk agent dev` defaults this to 0, so prewarm runs synchronously in every job's
    # critical path during local testing instead of ahead of time. Pinning it to 1
    # fixes that, and is deliberately low rather than the CPU-aware production
    # default: expected concurrency here is one visitor at a time, so more idle
    # processes would only cost memory for no benefit.
    num_idle_processes=1,
)


def prewarm(proc: JobProcess) -> None:
    """Load whatever the active pipeline architecture needs, once per worker process."""
    create_pipeline().prewarm(proc)


server.setup_fnc = prewarm


@server.rtc_session(agent_name="agent")
async def entrypoint(ctx: JobContext) -> None:
    pipeline = create_pipeline()

    # Routes this session's spans (LLM calls, tool calls, STT/TTS) to Langfuse, if
    # configured.
    trace_provider = setup_langfuse_tracing({"langfuse.session.id": ctx.room.name})
    if trace_provider is not None:

        async def _flush_trace() -> None:
            trace_provider.force_flush()

        ctx.add_shutdown_callback(_flush_trace)

    is_environment_noisy = watch_noise_signal(ctx.room)
    get_confidence_threshold = watch_confidence_threshold(
        ctx.room, DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD
    )

    session = pipeline.build_session(ctx)

    @session.on("user_input_transcribed")
    def _on_user_input_transcribed(ev: UserInputTranscribedEvent) -> None:
        pipeline.on_user_input_transcribed(session, ev)

    publish_latency_metrics(ctx.room, session)
    publish_turn_pairing(ctx.room, session)

    await session.start(
        agent=create_agent(is_environment_noisy, get_confidence_threshold),
        room=ctx.room,
    )

    await ctx.connect()

    # Static greeting for the cascade pipeline (no live TTS call -- pre-rendered in
    # prewarm); the realtime pipeline asks its model to speak it instead. Either way,
    # this file doesn't know or care which.
    pipeline.say_greeting(session, ctx)


if __name__ == "__main__":
    cli.run_app(server)
