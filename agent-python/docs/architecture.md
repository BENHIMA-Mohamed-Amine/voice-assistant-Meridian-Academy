# Architecture: the provider + pipeline seam

This project is a deliberate experimentation sandbox: the STT/TTS/LLM providers and
the whole voice architecture (cascaded vs. speech-to-speech) are meant to be swapped
often. `src/providers/` is the seam that makes that additive rather than invasive --
Strategy + Factory, per `CLAUDE.md` section 9.

## Two layers

```
providers/
├── base.py       Protocol per kind: STTProviderFactory, TTSProviderFactory,
│                 LLMProviderFactory, RealtimeModelFactory, and the top-level
│                 VoicePipeline Protocol.
├── stt.py        Concrete STT strategies (cascade leg) + registry + create_stt().
├── tts.py        Concrete TTS strategies (cascade leg) + registry + create_tts().
├── llm.py        Concrete LLM strategies (cascade leg) + registry + create_llm().
├── realtime.py   Concrete speech-to-speech strategies (GPT-Live via LiveKit
│                 Inference) + registry + create_realtime_model().
├── pipeline.py   CascadePipeline / SpeechToSpeechPipeline -- VoicePipeline
│                 implementations that own prewarm/session-build/greeting/
│                 transcription-hook behavior for their architecture.
└── factory.py    create_pipeline() -- reads PIPELINE_ARCHITECTURE, returns the
                  right VoicePipeline instance.
```

`src/main.py` only ever calls `create_pipeline()` and then
`pipeline.prewarm() / .build_session() / .say_greeting() / .on_user_input_transcribed()`.
It never imports a concrete provider, and never branches on which architecture is
active -- that is the whole point of the seam.

## Adding provider #2 within an architecture

Say you want a second TTS option (e.g. Cartesia) alongside Soniox:

1. In `providers/tts.py`, add a new class implementing `TTSProviderFactory`
   (same shape as `SonioxProvider`: a `build()` method returning a `tts.TTS`).
2. Add one line to `_TTS_REGISTRY`: `"cartesia": CartesiaProvider`.
3. Set `TTS_PROVIDER=cartesia` in `.env.local`.

No edits to `main.py`, `agent.py`, or `pipeline.py`.

## Adding architecture #2 (e.g. Gemini Live)

1. In `providers/realtime.py` (or a new module), add a provider class for the model.
2. In `providers/pipeline.py`, decide whether it fits the existing
   `SpeechToSpeechPipeline` (swap `create_realtime_model()`'s provider via
   `REALTIME_PROVIDER`) or needs its own `VoicePipeline` implementation entirely (e.g.
   if its greeting/transcription-hook behavior genuinely differs).
3. If it needs its own pipeline class, add one registry line in
   `_PIPELINE_REGISTRY` and set `PIPELINE_ARCHITECTURE` to the new key.

Either way, `main.py` doesn't change.

## Turn ordering for full-duplex models

A full-duplex realtime model (GPT-Live is the one shipped here) streams audio
continuously and only emits `conversation_item_added` for a turn *after* that turn's
audio finishes. A fast reply can therefore post its transcript before the visitor's
own "hi" transcript does -- and GPT-Live can also finalize more than one user turn
within a single continuous stretch of speech, since it chunks turns by its own pause
detection rather than 1:1 with raw mic VAD.

`signals/turn_pairing.py` fixes this without touching the framework's own (live-
streaming) transcription:

- It publishes a lightweight **order slot** the instant each side actually *starts*
  talking (`user_state_changed`/`agent_state_changed` -> `"speaking"`), which fires in
  real time and in true chronological order -- before any transcript exists.
- A **catch-up slot** is also published if a user turn finalizes with none already
  open (the multi-turn-per-stretch case above), so no turn is ever silently dropped.
- Confidence is published separately once a user turn finalizes (`item.transcript_confidence`
  is a plain field on `ChatMessage`, not an object -- a `MetricsReport` field like
  `item.metrics["llm_node_ttft"]` is a `TypedDict`, i.e. a dict at runtime, not an
  attribute; both are easy to get wrong by guessing from the TS/JS shape).

On `client/`, `hooks/useTurns.ts` consumes `lk.turns` to reserve each bubble's
position, then binds it to the Nth same-role message from the framework's own
`useSessionMessages()` feed -- so **ordering** comes from this channel, but the
**text itself still streams in live**, unchanged, from LiveKit's own transcription
forwarding. Don't replace that streaming source with text carried over `lk.turns`
directly (an earlier version of this tried that and visibly lost live streaming).

## Why the session carries the LLM (not the Agent)

The original TypeScript agent attaches the LLM to the `Agent` itself
(`Agent.create({ llm: ... })`). This port instead has `VoicePipeline.build_session()`
attach it to the `AgentSession` (`AgentSession(llm=create_llm())`), leaving
`MeridianAssistant` (in `agent/agent.py`) with no `llm` of its own -- it inherits the
session's. This keeps every model (STT, TTS, LLM, VAD, or a realtime model) assembled
in exactly one place (`providers/pipeline.py`), rather than split between the agent and
the session.
