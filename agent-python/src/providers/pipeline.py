"""VoicePipeline implementations: cascade (STT -> LLM -> TTS) and speech-to-speech."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from livekit import rtc
from livekit.agents import voice
from livekit.agents.utils import http_context
from livekit.plugins import silero

from providers.llm import create_llm
from providers.realtime import create_realtime_model
from providers.stt import create_stt
from providers.tts import create_tts

if TYPE_CHECKING:
    from livekit.agents import JobContext, JobProcess

logger = logging.getLogger("agent.pipeline")

# Fixed text, spoken once at the very start of every session before the visitor has
# said anything -- synthesized once in prewarm (not at session start) so it plays with
# no TTS time-to-first-byte at all rather than shaving it down.
GREETING_TEXT = (
    "Hi there, welcome to Meridian Academy! I'm here to help you book a demo with our "
    "team. Whenever you're ready, just say the word and we'll get started."
)

# Cascade turn handling: Flux's own phrase-endpointing model decides end-of-turn
# directly (turn_detection="stt"), instead of waiting on a generic turn detector.
# min_delay=0.0 since Flux already runs its own endpointing -- no extra delay added
# on top. interruption mode "adaptive" tells a genuine interruption apart from
# backchanneling. preemptive_generation disabled: caused duplicated/fragmented
# replies in testing (per the TS version this was ported from).
_CASCADE_TURN_HANDLING: Any = {
    "turn_detection": "stt",
    "endpointing": {"mode": "fixed", "min_delay": 0.0, "max_delay": 3.0},
    "interruption": {"mode": "adaptive"},
    "preemptive_generation": {"enabled": False},
}


class CascadePipeline:
    """STT -> LLM -> TTS, with Silero VAD for interruption detection.

    VAD here only feeds interruption detection; end-of-turn comes from the STT
    (turn_detection="stt" above).
    """

    def prewarm(self, proc: JobProcess) -> None:
        """Load VAD, and pre-render the greeting via a throwaway TTS client."""
        proc.userdata["vad"] = silero.VAD.load(min_silence_duration=0.35)

        frames: list[rtc.AudioFrame] = []

        async def _render() -> None:
            # Prewarm runs outside a job context, so plugins that need an HTTP
            # session (like Soniox TTS) need one opened explicitly here.
            async with http_context.open():
                greeting_tts = create_tts()
                async for audio in greeting_tts.synthesize(GREETING_TEXT):
                    frames.append(audio.frame)
                await greeting_tts.aclose()

        asyncio.run(_render())
        proc.userdata["greeting_audio"] = frames

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        """Build the cascade AgentSession: separate STT, LLM, TTS, and VAD."""
        return voice.AgentSession(
            stt=create_stt(),
            llm=create_llm(),
            tts=create_tts(),
            vad=ctx.proc.userdata["vad"],
            turn_handling=_CASCADE_TURN_HANDLING,
            expressive=True,
        )

    def say_greeting(self, session: voice.AgentSession, ctx: JobContext) -> None:
        """Replay the greeting frames cached in prewarm -- no live TTS call."""
        frames: list[rtc.AudioFrame] = ctx.proc.userdata["greeting_audio"]

        async def _frames() -> Any:
            for frame in frames:
                yield frame

        session.say(GREETING_TEXT, audio=_frames())

    def on_user_input_transcribed(self, session: voice.AgentSession, ev: Any) -> None:
        """Keep the reply's spoken language matched to whatever the visitor last used."""
        if ev.is_final and ev.language and session.tts is not None:
            # update_options is provider-specific (Soniox has it), not on the TTS base.
            session.tts.update_options(language=ev.language)  # type: ignore[attr-defined]


class SpeechToSpeechPipeline:
    """One realtime model, audio in -> audio out directly, no separate STT/TTS.

    GPT-Live (the default realtime provider) is full-duplex: it listens while it
    speaks and decides its own turns. The AgentSession still needs a VAD, though --
    it's what the session uses to detect barge-in and cut the agent's own playback.
    Without it, the agent would play until the model itself stopped talking.
    """

    def prewarm(self, proc: JobProcess) -> None:
        """Load VAD for barge-in detection (the realtime model handles the rest)."""
        proc.userdata["vad"] = silero.VAD.load(min_silence_duration=0.35)

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        """Build a speech-to-speech AgentSession: one realtime model as the llm."""
        return voice.AgentSession(
            llm=create_realtime_model(),
            vad=ctx.proc.userdata["vad"],
            expressive=True,
        )

    def say_greeting(self, session: voice.AgentSession, ctx: JobContext) -> None:
        """Ask the realtime model to speak the greeting itself."""
        session.generate_reply(instructions=f"Greet the visitor by saying: {GREETING_TEXT}")

    def on_user_input_transcribed(self, session: voice.AgentSession, ev: Any) -> None:
        """No-op: the realtime model handles language switching internally."""


_PIPELINE_REGISTRY: dict[str, type[CascadePipeline] | type[SpeechToSpeechPipeline]] = {
    "cascade": CascadePipeline,
    "realtime": SpeechToSpeechPipeline,
}
