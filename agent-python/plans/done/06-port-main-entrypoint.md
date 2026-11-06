# Plan — Phase 6: Port `main.py`

**Status:** done

**Revision note (2026-11-06):** `main.py` now drives the voice pipeline entirely
through the `VoicePipeline` strategy from phase 2 — it does not know or care whether
it's running cascade or speech-to-speech. No architecture branching lives here.

## Goal

Port the entrypoint as a thin driver: get the pipeline from the factory, call its four
methods (`prewarm`, `build_session`, `say_greeting`, `on_user_input_transcribed`), wire
latency/signal publishing on top. This is where unit-level confidence runs out for
exact param names/units — treat them as unverified until checked against the live
Python docs, not assumed from the TS version.

## Steps

- [x] 1. `prewarm(proc)`: `pipeline = create_pipeline(); pipeline.prewarm(proc)`.
      Nothing architecture-specific here — the cascade pipeline loads VAD + pre-renders
      the greeting internally; a realtime pipeline may do nothing or its own cheap
      warmup. `main.py` doesn't know which.
      → verify: unit test with `PIPELINE_ARCHITECTURE=cascade` asserts
      `proc.userdata["vad"]` and `["greeting_audio"]` populated; with `=realtime`,
      asserts prewarm doesn't raise and doesn't require STT/TTS env vars to be set.
- [x] 2. `entry(ctx)`: `pipeline = create_pipeline(); session = pipeline.build_session(ctx)`.
      → sub-step: for the cascade path, confirm the exact Python param name/shape for
      adaptive interruption and endpointing units (seconds vs. ms — TS used ms) via
      `docs_search` before writing — this is the single riskiest line to port wrong,
      independent of this revision.
      → sub-step: for the realtime path, confirm whether `expressive=True` /
      `turn_detection` even apply to a `RealtimeModel`-only session, or if those kwargs
      should be omitted entirely in that branch of `CascadePipeline`/
      `SpeechToSpeechPipeline` (this lives inside `providers/pipeline.py`, not here).
      → verify: integration smoke test constructs a session via each pipeline with
      mocked providers, asserts no exception either way.
- [x] 3. `session.on(voice.AgentSessionEventTypes.UserInputTranscribed, lambda ev:
      pipeline.on_user_input_transcribed(session, ev))` — registered unconditionally;
      the cascade pipeline retargets TTS language, the realtime pipeline no-ops.
      → verify: unit test fires the event against each pipeline, asserts the cascade
      one calls `tts.update_options` and the realtime one does nothing (no AttributeError
      from a missing `tts`).
- [x] 4. `pipeline.say_greeting(session, ctx)` after `ctx.connect()` — cascade replays
      cached frames, speech-to-speech asks the model to speak the greeting via
      `generate_reply`/equivalent.
      → verify: covered by the end-to-end run in phase 7 for whichever architecture is
      selected, not a unit test (this is genuinely I/O-shaped).
- [x] 5. **Confirmed via docs (2026-11-06):** the current Python entrypoint API is
      `AgentServer`/`@server.rtc_session()`, not the older `WorkerOptions`/
      `cli.run_app(WorkerOptions(...))` pattern (that's the Node.js shape).
      `server = AgentServer(num_idle_processes=1)`, `server.setup_fnc = prewarm`,
      `@server.rtc_session(agent_name="agent")` decorating `entry()`, and
      `cli.run_app(server)` under `if __name__ == "__main__":`.
      → verify: `python src/main.py start --help` runs without import errors, with
      `PIPELINE_ARCHITECTURE` unset (defaults to `cascade`, today's behavior).

## Note for phase 7

Phase 7's live manual QA checklist should be run once with `PIPELINE_ARCHITECTURE=cascade`
(the default — must match TS behavior exactly) and, if the user wants it validated this
round, once more with `=realtime` to confirm the seam actually produces a working
speech-to-speech session end-to-end, not just that it imports.

## Done / Challenges / Solution

_(filled in during execution)_
