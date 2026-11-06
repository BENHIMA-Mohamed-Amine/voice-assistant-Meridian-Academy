# Plan — Phase 2: Provider & pipeline abstraction layer (Strategy + Factory)

**Status:** done

**Revision note (2026-11-06):** widened from "swap STT/TTS/LLM providers" to also
support swapping the whole **voice architecture** — cascaded (STT→LLM→TTS) vs.
speech-to-speech / realtime (one model does audio-in → audio-out directly, e.g. OpenAI
Realtime API, Gemini Live). `main.py` must not branch on architecture type at all —
see the `VoicePipeline` design below.

## Goal

Make both (a) individual providers within a pipeline, and (b) the pipeline
*architecture* itself, swappable by config — zero edits to `main.py`/`agent.py` to add
a new provider, or to switch between cascade and speech-to-speech.

## Background: the two architectures

| | Cascade (current/default) | Speech-to-speech / realtime |
|---|---|---|
| Components | separate STT + LLM + TTS | one `RealtimeModel` (audio in → audio out) |
| VAD | used, for interruption | usually not needed — model has server-side turn detection |
| Turn detection | from STT (`turn_detection="stt"`) | the realtime model's own |
| Language switch | re-target TTS via `update_options` | handled inside the model itself |
| Latency | higher, but each stage is independently swappable/inspectable | lower baseline, less fine-grained control |
| Examples | Deepgram + Groq/Qwen + Soniox (today) | OpenAI Realtime API, Gemini Live |

(Confirmed via LiveKit docs: `AgentSession(llm=...)` accepts either an `llm.LLM` in a
cascade, or an `llm.RealtimeModel` on its own, with `stt`/`tts` omitted.)

## Design

Two layers of Strategy + Factory, per `CLAUDE.md` §9:

**1. Per-component strategies (cascade building blocks)** — unchanged from the
original plan: `providers/stt.py`, `providers/tts.py`, `providers/llm.py`, each with a
base Protocol in `providers/base.py` and a registry + `create_*()` factory function.

**2. Pipeline strategy (new, this revision)** — `providers/pipeline.py` defines a
`VoicePipeline` Protocol that owns *everything* that differs by architecture, so
`main.py` calls the same four methods regardless of which one is active:

```python
# providers/base.py
class VoicePipeline(Protocol):
    """Build and drive an AgentSession for one voice architecture."""

    def prewarm(self, proc: JobProcess) -> None:
        """Load whatever this architecture needs once per worker process."""
        ...

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        """Construct the fully configured AgentSession for this architecture."""
        ...

    def say_greeting(self, session: voice.AgentSession, ctx: JobContext) -> None:
        """Produce the opening greeting, however this architecture does that."""
        ...

    def on_user_input_transcribed(self, session: voice.AgentSession, ev: object) -> None:
        """React to a transcription event (e.g. retarget TTS language). No-op if N/A."""
        ...
```

```python
# providers/pipeline.py
class CascadePipeline:
    """STT -> LLM -> TTS, with Silero VAD for interruption (today's behavior)."""

    def prewarm(self, proc: JobProcess) -> None:
        proc.userdata["vad"] = silero.VAD.load(min_silence_duration=0.35)
        proc.userdata["greeting_audio"] = _render_greeting(create_tts())

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        return voice.AgentSession(
            stt=create_stt(), llm=create_llm(), tts=create_tts(),
            vad=ctx.proc.userdata["vad"], turn_detection="stt",
            ...
        )
    # say_greeting: replay proc.userdata["greeting_audio"]
    # on_user_input_transcribed: session.tts.update_options(language=ev.language)


class SpeechToSpeechPipeline:
    """One realtime model, no separate STT/TTS/VAD."""

    def prewarm(self, proc: JobProcess) -> None:
        pass  # nothing cheap to precompute; the model handles its own warmup

    def build_session(self, ctx: JobContext) -> voice.AgentSession:
        return voice.AgentSession(llm=create_realtime_model())
    # say_greeting: session.generate_reply(instructions=GREETING_TEXT) (model speaks it)
    # on_user_input_transcribed: no-op — the model handles language itself


_PIPELINE_REGISTRY: dict[str, type[VoicePipeline]] = {
    "cascade": CascadePipeline,
    "realtime": SpeechToSpeechPipeline,
}
```

```python
# providers/factory.py
def create_pipeline() -> VoicePipeline:
    """Create the voice pipeline selected by PIPELINE_ARCHITECTURE (default: cascade)."""
    name = os.environ.get("PIPELINE_ARCHITECTURE", "cascade")
    pipeline_cls = _PIPELINE_REGISTRY.get(name)
    if pipeline_cls is None:
        raise ValueError(
            f"Unknown PIPELINE_ARCHITECTURE: {name!r}. Known: {sorted(_PIPELINE_REGISTRY)}"
        )
    return pipeline_cls()
```

`main.py`'s `prewarm`/`entry` become: `pipeline = create_pipeline()`, then
`pipeline.prewarm(proc)` / `pipeline.build_session(ctx)` / `pipeline.say_greeting(...)` /
`pipeline.on_user_input_transcribed(...)` — **no `if architecture == "cascade"` anywhere
in `main.py`.** See `06-port-main-entrypoint.md` (updated).

## New env vars (added to `01-scaffold-project.md`'s `.env.example`)

- `PIPELINE_ARCHITECTURE` — `cascade` (default, matches today's TS behavior) |
  `realtime`.
- `REALTIME_PROVIDER` — which realtime model to use when `PIPELINE_ARCHITECTURE=realtime`
  (default: `gpt_live`, updated 2026-11-06 from the original `openai_realtime` plan --
  the user chose GPT-Live over the direct OpenAI Realtime API plugin, so this ships
  via LiveKit Inference instead, no `OPENAI_API_KEY` needed). Registered the same
  registry way as STT/TTS/LLM.

Only **one** concrete realtime provider (`OpenAIRealtimeProvider`, via the `openai`
plugin's Realtime API) ships in this phase — enough to prove the seam works end-to-end.
Gemini Live and others are documented as "add provider #2 here" in
`docs/architecture.md`, not pre-built speculatively (`CLAUDE.md` §2).

## Steps

- [x] 1. `providers/base.py` — the three cascade-component Protocols (unchanged) plus
      the new `VoicePipeline` Protocol above.
      → verify: `mypy` clean, no concrete logic yet.
- [x] 2. `providers/stt.py`, `tts.py`, `llm.py` — as originally planned (Deepgram,
      Soniox, Groq-via-OpenAI-compatible), unchanged by this revision.
- [x] 3. `providers/realtime.py` — `OpenAIRealtimeProvider` (speech-to-speech) +
      registry + `create_realtime_model()`. Confirm the exact Python class
      (`openai.realtime.RealtimeModel` or similar) via `docs_search`/`code_search`
      before writing — don't guess from the cascade LLM plugin's API shape.
      → verify: unit test instantiates it, asserts it returns an `llm.RealtimeModel`.
- [x] 4. `providers/pipeline.py` — `CascadePipeline` (wraps the existing
      stt/llm/tts/vad wiring from the original main.py design) and
      `SpeechToSpeechPipeline` (wraps the realtime model, no stt/tts/vad), both
      implementing `VoicePipeline`.
      → verify: unit test builds each pipeline with mocked providers, asserts
      `build_session()` returns an `AgentSession` with the right components
      populated/omitted (e.g. cascade has `tts` set, realtime pipeline's session has no
      separate `tts`).
- [x] 5. `providers/factory.py` — `create_pipeline()` registry lookup, matching the
      `create_stt`/`create_tts`/`create_llm`/`create_realtime_model` pattern.
      → verify: unit test asserts `ValueError` on an unknown `PIPELINE_ARCHITECTURE`
      value, and that each known value returns the right pipeline class.
- [x] 6. `docs/architecture.md` — document both layers of the seam: how to add
      provider #2 within an architecture (e.g. a second TTS), and how to add
      architecture #2 (e.g. Gemini Live) by writing one more `VoicePipeline`
      implementation and one registry line.
      → verify: re-read it cold — could you add Gemini Live from this doc alone,
      without touching `main.py`?

## Done / Challenges / Solution

_(filled in during execution)_
