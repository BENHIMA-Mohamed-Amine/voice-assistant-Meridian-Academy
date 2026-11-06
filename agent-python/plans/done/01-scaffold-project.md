# Plan — Phase 1: Scaffold the Python project

**Status:** done

## Goal

Stand up `agent-python/` as a runnable (empty) Python project — deps, env, lint/type
tooling — so later phases just add files, not infrastructure.

## Steps

- [x] 1. Add `pyproject.toml`: project metadata, Python `>=3.12`, deps
      `livekit-agents[deepgram,soniox,silero,openai]` (the `openai` extra covers both
      the cascade LLM and the speech-to-speech `RealtimeModel` from phase 2),
      `python-dotenv`; dev deps `pytest`, `pytest-asyncio`, `ruff`, `mypy` (or `pyright`).
      → verify: `uv sync` (or `pip install -e .`) completes with no errors.
- [x] 2. Copy `.env.example` from `../agent/.env.example` as-is — env var names are
      identical across both implementations (`LIVEKIT_URL`, `GROQ_API_KEY`,
      `SONIOX_API_KEY`, `DEEPGRAM_API_KEY`, `SLACK_WEBHOOK_URL`, `LANGFUSE_*`), plus new
      `STT_PROVIDER` / `TTS_PROVIDER` / `LLM_PROVIDER` for phase 2's component factory,
      plus `PIPELINE_ARCHITECTURE` (`cascade` default | `realtime`), `REALTIME_PROVIDER`
      (default `openai_realtime`), and `OPENAI_API_KEY` (only required when
      `PIPELINE_ARCHITECTURE=realtime`) — see `02-provider-abstraction-layer.md`.
      → verify: diff against the TS `.env.example`, only the new vars added, and the
      defaults reproduce today's cascade behavior with zero config changes.
- [x] 3. `ruff.toml` (or `[tool.ruff]` in `pyproject.toml`): line length, import sort,
      matching the strictness of the existing `eslint.config.ts`.
      → verify: `ruff check .` runs clean on an empty `src/`.
- [x] 4. `mypy.ini` (or `[tool.mypy]`): `strict = true`, matching `tsconfig.json`'s
      strictness.
      → verify: `mypy src` runs clean on an empty `src/`.
- [x] 5. `src/__init__.py`, empty `tests/__init__.py`, `.gitignore` additions
      (`.venv/`, `__pycache__/`, `*.pyc`).
      → verify: `pytest` runs (0 collected, exit 0).

## Done / Challenges / Solution

_(filled in during execution)_
