# Plan — TS → Python backend migration — overview

**Status:** approved

## Goal

Port the LiveKit voice agent backend (`agent/`, currently Node.js/TypeScript) to Python,
with a Strategy + Factory provider layer so STT/TTS/LLM providers **and the voice
architecture itself** (cascaded STT→LLM→TTS vs. speech-to-speech/realtime, e.g. OpenAI
Realtime, Gemini Live) can be swapped by config, not by editing core code. Client
(`client/`) is untouched.

## Standing instructions for this migration (from the user, keep applying across phases)

- Carry the whole migration through, phase by phase, **end to end** — don't stop between
  phases to re-ask unless a phase below is still `proposed` or something genuinely new/
  risky comes up (see `CLAUDE.md` §5).
- Every phase that touches runtime behavior ends with an actual run + validation that the
  agent responds (not just "tests pass") — see `CLAUDE.md` §4.
- Apply SOLID, especially Open/Closed, specifically to the provider layer (`providers/`):
  new STT/TTS/LLM = new class + registry entry, and new voice **architecture**
  (cascade vs. speech-to-speech/realtime) = new `VoicePipeline` class + registry entry —
  zero edits to `main.py`/`agent.py` either way. See `CLAUDE.md` §9 and
  `02-provider-abstraction-layer.md`.
- Don't over-apply patterns where there's no real variant yet (`CLAUDE.md` §2, §9 last
  bullet) — e.g. the single `notify_support_team` tool stays a plain function for now.

## Phases

| # | Plan file | Covers | Status |
|---|---|---|---|
| 1 | [`done/01-scaffold-project.md`](done/01-scaffold-project.md) | `pyproject.toml`, deps, env, lint/type config | ✅ done |
| 2 | [`done/02-provider-abstraction-layer.md`](done/02-provider-abstraction-layer.md) | Strategy bases + Factory for STT/TTS/LLM, **and** for the pipeline architecture (cascade vs. speech-to-speech/realtime) | ✅ done |
| 3 | [`done/03-port-pure-logic.md`](done/03-port-pure-logic.md) | `email.py`, `audio_quality.py` + unit tests | ✅ done |
| 4 | [`done/04-port-livekit-signals-telemetry.md`](done/04-port-livekit-signals-telemetry.md) | noise/confidence/latency signals, Langfuse tracing, turn ordering | ✅ done |
| 5 | [`done/05-port-agent-and-tools.md`](done/05-port-agent-and-tools.md) | `agent.py`, `tools.py` | ✅ done |
| 6 | [`done/06-port-main-entrypoint.md`](done/06-port-main-entrypoint.md) | `main.py` — prewarm, session wiring, greeting | ✅ done |
| 7 | [`done/07-tests-and-scenario-validation.md`](done/07-tests-and-scenario-validation.md) | pytest evals, live manual QA (user-driven) | ✅ done |
| 8 | [`done/08-deployment-and-tooling.md`](done/08-deployment-and-tooling.md) | Dockerfile, CI, `livekit.toml` | ✅ done |
| 9 | [`09-docs-and-cutover.md`](09-docs-and-cutover.md) | README/architecture docs, delete TS, rename `agent-python/` → `agent/` | 🟡 docs done; **cutover (deleting the TS agent) deliberately not run** — destructive, needs explicit go-ahead, separate from deployment |

Phases 1–8 are complete and verified, including by the user's own live manual test
(which also surfaced and fixed real bugs: the `prewarm()` HTTP-context gotcha, and two
GPT-Live-specific turn-ordering issues — see `docs/silent-bug-risks.md`). Along the
way, the realtime architecture's default provider became GPT-Live via LiveKit
Inference (swapped from the originally-scaffolded OpenAI Realtime API plugin, per the
user's explicit choice) — see `02-provider-abstraction-layer.md`'s revision note.
Phase 9's docs step is done too; its cutover step (irreversible) stays pending a
separate explicit go-ahead, distinct from deploying the agent to LiveKit Cloud.

## Source of truth

The existing TypeScript implementation at `../agent/` (`src/`, `README.md`, `AGENTS.md`,
`tests/`, `scenarios.yaml`) is the behavioral spec. Every phase below ports *behavior*
first; the provider abstraction (phase 2) is the one deliberate architectural addition,
requested explicitly because this project is an experimentation sandbox for swapping
models/providers.
