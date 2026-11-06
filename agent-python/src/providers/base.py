"""Strategy bases for swappable providers and voice-pipeline architectures.

Each provider kind (STT, TTS, LLM, realtime model) gets one abstract base here, and
each concrete provider implements it in its own module (stt.py, tts.py, llm.py,
realtime.py). `VoicePipeline` is one level up: it owns everything that differs between
the cascaded (STT -> LLM -> TTS) and speech-to-speech/realtime architectures, so
`main.py` never branches on which one is active.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from livekit.agents import JobContext, JobProcess, llm, stt, tts, voice


class STTProviderFactory(Protocol):
    """Build a configured STT instance."""

    def build(self) -> stt.STT:
        """Create the STT instance for this provider."""
        ...


class TTSProviderFactory(Protocol):
    """Build a configured TTS instance."""

    def build(self) -> tts.TTS:
        """Create the TTS instance for this provider."""
        ...


class LLMProviderFactory(Protocol):
    """Build a configured (cascade) LLM instance."""

    def build(self) -> llm.LLM:
        """Create the LLM instance for this provider."""
        ...


class RealtimeModelFactory(Protocol):
    """Build a configured speech-to-speech realtime model instance.

    `llm.DuplexModel` covers full-duplex models (e.g. GPT-Live); a turn-based
    provider would instead return `llm.RealtimeModel` -- both slot into
    `AgentSession(llm=...)`.
    """

    def build(self) -> llm.RealtimeModel | llm.DuplexModel:
        """Create the realtime model instance for this provider."""
        ...


class VoicePipeline(Protocol):
    """Build and drive an AgentSession for one voice architecture.

    Implementations own everything that differs by architecture (cascade vs.
    speech-to-speech): what to prewarm, how to build the session, how to speak the
    opening greeting, and how to react to a user-input-transcribed event. `main.py`
    calls only these four methods and never checks which architecture is active.
    """

    def prewarm(self, proc: JobProcess) -> None:
        """Load whatever this architecture needs once per worker process."""
        ...

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        """Construct the fully configured AgentSession for this architecture."""
        ...

    def say_greeting(self, session: voice.AgentSession, ctx: JobContext) -> None:
        """Produce the opening greeting, however this architecture does that."""
        ...

    def on_user_input_transcribed(self, session: voice.AgentSession, ev: Any) -> None:
        """React to a transcription event (e.g. retarget TTS language). No-op if N/A."""
        ...
