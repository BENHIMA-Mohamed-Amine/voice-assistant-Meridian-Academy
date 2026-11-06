# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. They bias toward caution over speed; for trivial tasks, use judgment. Section numbers are referenced elsewhere: keep them stable.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain or unclear, stop, name what's confusing, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No unrequested features, single-use abstractions, or "flexibility".
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite. Ask: "Would a senior engineer call this overcomplicated?"
- Exception: Section 9 below overrides this for anything that is actually a provider/model/strategy variant (STT, TTS, LLM, turn-detection, etc.) — those get the Open/Closed treatment on purpose, because this project exists to swap them.

## 3. Surgical Changes

**Touch only what you must. Every changed line must trace to the user's request.**

- Don't "improve" adjacent code, comments or formatting; don't refactor what isn't broken; match existing style.
- Unrelated dead code: mention it, don't delete it.
- Remove imports/variables/functions that YOUR changes made unused; leave pre-existing dead code.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- "Add validation" → tests for invalid inputs, then make them pass. "Fix the bug" → a test that reproduces it, then make it pass. "Refactor X" → tests pass before and after.
- Multi-step tasks: state a brief plan, one line per step: `1. [Step] → verify: [check]`.

## 5. Execute Explicit Instructions

**A clear, actionable instruction gets done. Don't substitute your own process step.**

- Don't add approval/planning/confirmation steps out of habit when the ask was unambiguous.
- Confirm only for genuine ambiguity, multiple valid approaches, or new risk. If unsure whether it's "confirmed enough", name that and ask.
- Not blind compliance: if an instruction is unsound or will cause pain later, say so BEFORE starting (Rule 1). Push back once, clearly, then follow the user's call.
- **This project's standing instruction:** the user has asked for the full TS→Python migration to be carried out end-to-end, phase by phase, by Claude — including running the agent and validating it actually responds before any phase is marked done. Don't stop to re-ask for permission between phases unless a phase's plan file is still `proposed` (see Section 6) or something genuinely new/risky comes up.

## 6. Workflow: Plan-Driven Execution

**Big features (new capability, architectural work, multi-file change) get a tracked plan. Small fixes don't.**

**Planning**
- Check `plans/` for a matching plan first. If none, create `plans/<task-name>.md`: **Goal** (one sentence), **Status** at the top (`proposed` → `approved` → `done`, or `deferred`), **Steps** split until each is one independently testable action.
- Include short code snippets of the key changes (sketch or before/after, not the full implementation).
- After drafting, STOP and ask for approval. Set `approved` only after the user confirms.

**Execution**
- Never execute a `proposed` plan. One step at a time; tick `[x]` only when done AND verified (run/tested, not just written).
- Under each step note **Done**, **Challenges**, **Solution**. If a step is bigger than expected, split it first.

**Resuming**
- At session start, resume the first unchecked step of any `approved` plan.
- All steps checked ≠ `done`: tell the user it's ready for review. Set `done` and move the file to `plans/done/` only on their explicit confirmation.

## 7. Project Structure (Living Section)

**Keep the section below current. Additive only, never wipe it.**

- Add an entry (one-line description) for each new file/folder; update descriptions in place when a role changes.
- Don't remove an entry because you're unsure it's accurate: check first.

## Project Structure

```
agent-python/
├── CLAUDE.md
├── pyproject.toml
├── src/
│   ├── main.py                 # entrypoint: prewarm, session wiring, cli.run_app
│   ├── agent/
│   │   ├── agent.py            # Agent instructions, on_user_turn_completed hook
│   │   ├── tools.py            # function_tool definitions (notify_support_team, ...)
│   │   ├── email.py            # work-email domain check
│   │   └── audio_quality.py    # pure note-builder logic
│   ├── providers/               # Strategy + Factory layer for swappable providers AND architectures
│   │   ├── base.py             # Protocol/ABC per provider kind + the VoicePipeline Protocol
│   │   ├── stt.py              # concrete STT strategies + registry (cascade leg)
│   │   ├── tts.py              # concrete TTS strategies + registry (cascade leg)
│   │   ├── llm.py              # concrete LLM strategies + registry (cascade leg)
│   │   ├── realtime.py         # concrete speech-to-speech model strategies + registry
│   │   ├── pipeline.py         # CascadePipeline / SpeechToSpeechPipeline (VoicePipeline impls)
│   │   └── factory.py          # reads config/env, returns the right strategy/pipeline instance
│   └── signals/                 # NOT named `livekit/` -- that would shadow the real
│       │                        # `livekit` PyPI namespace package once src/ is on
│       │                        # sys.path, breaking every `livekit.agents` import.
│       ├── noise_signal.py
│       ├── confidence_signal.py
│       ├── confidence_threshold_signal.py
│       ├── latency_metrics.py
│       └── tracing.py
├── tests/
├── docs/
└── plans/
    ├── done/          # completed plans, moved here once status reaches `done`
    └── handoffs/      # session handoff files (temporary, remove when work is done)
```

## 8. Response Style

**Scannable, chunked, skimmable, bite-sized, with white space. Never a wall of text.**

- Answer first. No preamble, no restating the question, no closing recap.
- Short sentences. One idea per bullet.
- Use bullets, tables, short headers, and bold key words.
- Max 3 lines per block. Blank line between blocks.
- 3+ lines of stacked prose: rewrite as bullets or a table.
- Skip caveats that don't change the answer. Offer to expand instead of dumping detail.
- Full detail only when asked, or for errors and risky actions. Keep it chunked even then.

## 9. Code Quality

**SOLID, clear, idiomatic. One source of truth per fact.**

- **Open/Closed first:** extend by adding code, not editing working code. Callers depend on abstractions (base classes, protocols); a new provider, format or rule = a new class + a registration. **No `if type == "x"` / `elif name == ...` chains in core logic.**
- **S:** one job per class/module (can't name it without "and" → split). **L:** subclasses work wherever the base does. **I:** narrow interfaces. **D:** inject dependencies, don't instantiate them inside logic.
- **No rigid codes:** values the system receives (language codes, provider/model names, types) work without editing core code. If one must be special-cased, flag it in `docs/silent-bug-risks.md` (Rule 14).
- **Patterns where a variant is added:** registry/factory, template method, strategy. Prefer the framework's own base class.
- **Review your diff:** a branch on a type/name/code, or a new variant that needed edits to existing code, is a violation: refactor before reporting.
- Be idiomatic for the language; follow its conventions, not another ecosystem's.
- **Single source of truth:** each fact, config value or piece of logic lives in one place.
- Apply SOLID/DRY only where a real second case or duplication exists, never speculatively (Rule 2).

**Project-specific (why this matters here):** this repo is a deliberate experimentation sandbox — the user will swap STT/TTS/LLM providers and models repeatedly, **and** will swap the whole voice architecture (cascaded STT→LLM→TTS vs. speech-to-speech/realtime, e.g. OpenAI Realtime, Gemini Live). So, specifically for `src/providers/`:
- Each provider kind (STT, TTS, LLM, realtime model) gets one abstract base (**Strategy**) in `providers/base.py`.
- Each concrete provider (Deepgram, Soniox, Groq/OpenAI-compatible, OpenAI Realtime, a future one) is its own class implementing that base — never a branch inside shared logic.
- The architecture itself is a Strategy too: `VoicePipeline` (also in `providers/base.py`), implemented by `CascadePipeline` and `SpeechToSpeechPipeline` in `providers/pipeline.py`. `main.py` calls only `pipeline.prewarm()` / `.build_session()` / `.say_greeting()` / `.on_user_input_transcribed()` — it never checks which architecture is active.
- Small **Factory**/registry functions (`providers/factory.py`) map a config value (e.g. `STT_PROVIDER=deepgram`, `PIPELINE_ARCHITECTURE=cascade`) to the right class. Adding provider #2, or architecture #2, means adding a class + one registry entry — zero edits to `main.py` or `agent.py`.
- `main.py`/`agent.py` depend only on the abstract base types (Dependency Inversion) — they never import a concrete provider or pipeline directly.

## 10. Python Code Style (Python Projects)

**MANDATORY: Python 3.12+ type hints and Google-style docstrings on all code you write or touch. Fix violations before reporting done.**

- **Hints on every parameter and return**, incl. `-> None` on `__init__` and void functions.
- `X | None` / `X | Y`, never `Optional`/`Union`. Built-in generics (`list[str]`, `dict[str, Any]`, `type[X]`), never `List`/`Dict`/`Type`. `collections.abc.Callable`, never `typing.Callable`.
- **Docstring on every public class, function and method:** first line one imperative sentence ("Create ...", not "Creates ..."). `Args:`/`Returns:`/`Raises:` only when they add non-obvious value.
- Check every function you added or edited (tests and helpers too) before reporting done.

```python
def create_service(self, config: dict[str, Any]) -> Service:
    """Create a service from config.

    Raises:
        ValueError: If provider type is unsupported.
    """
```

## 11. Error Handling

Before writing any `try/except`, read the project's error-handling guide in `docs/` if one exists.

- **Raise in logic. Catch at the boundary only** (lifespan, router, entry point). Never catch and swallow inside business logic.
- `logger.exception()` at every catch boundary (not `logger.error(..., exc_info=True)`); `raise X from exc` when re-raising as another type; specific exceptions first, bare `Exception` last.
- Custom exceptions live in one dedicated module; add one only when the boundary needs distinct behavior.

## 12. Project Context

Before any task, read [`docs/`](docs/), [`README.md`](README.md) and [`plans/`](plans/) (active and completed). Also read the sibling TypeScript implementation at `../agent/` (`src/`, `README.md`, `AGENTS.md`) — that is the behavioral source of truth this Python port must match.

## 13. Available Tools & Documentation Sources

- **LiveKit Docs MCP server** — always check Python plugin reference pages (`/reference/python/livekit/plugins/...`) before wiring a provider; API shapes (param names, units) differ subtly from the Node.js SDK this was ported from.
- **`agent:livekit-agents` skill** (or the unscoped `livekit-agents` skill once this becomes the project's main `agent/`) — load before building/testing voice agent behavior. Mandatory: it requires tests for all implementations.
- Mandatory before writing provider code: confirm the exact Python class/param names via docs search or `code_search` against `livekit/agents` — don't guess from the TS version.

## 14. Documenting Changes

Update the docs in the same change. **The project must not depend on its creator:** write for a teammate who has never seen it (what, why, how to change it).

- A fallback, default or coupling that could fail quietly gets an entry in `docs/silent-bug-risks.md` (create if missing): what happens → why it's silent → how to spot it → how to avoid it.
- Put it in `README.md` (structure, setup, features) or `docs/` (architecture, how-tos, config guides); follow the user's stated preference.
- Keep the edit scoped. Skip for pure refactors, bug fixes, and plan files that don't change documented behavior.

## 15. Concurrency (Multi-Session Services)

**MANDATORY when one process serves many requests/sessions: code that works for one local request can silently mix data between users.**

- **State is per session, never per process.** No module-level/singleton mutable state holding request data. If unavoidable, key it by session id and remove it when the session ends.
- Shared singletons (handlers, callbacks, clients) must be stateless or keyed per session. Ask: "if two requests hit this at once, whose data is in this variable?"
- Prefer objects created per request/run. In asyncio, no `await` between a check and the use of shared state; use `contextvars` for per-task context.
- A new shared/global component gets a test with two interleaved sessions.
- Before reporting done, state the scope (per run / session / process) of every attribute or global you added. Unremovable risks go in `docs/silent-bug-risks.md`.

## 16. Non-Blocking Code (Async Python)

**MANDATORY: one event loop serves every request. A blocking call in one session freezes all of them.**

Pick the first option that fits (`asyncio.to_thread` is **not** the default):
1. **Async-native API** (`httpx.AsyncClient`, `redis.asyncio`, `Async*` clients, `asyncio.sleep`).
2. **Call directly if trivially fast** (in-memory, microseconds); don't pay for a thread hop.
3. **`asyncio.to_thread()` for blocking I/O only**, when no async API exists. Doesn't speed up CPU-bound work; the shared executor is bounded, so keep calls few and short.
4. **`ProcessPoolExecutor` via `loop.run_in_executor()` for CPU-bound work**, or move it to a separate service.

Rules:
- Event-loop handlers stay fast; hand slow work to a background task (keep a reference).
- Timeout every external call (`asyncio.timeout()` / `wait_for()`); also set the client timeout for `to_thread` work, which can't be cancelled.
- Never `time.sleep()`, `requests.*` or blocking SDK calls inside `async def`; never `.result()` / `.join()` / `asyncio.run()` from async code.
- Await every coroutine. "Never awaited" warnings are bugs.
- Find offenders with `PYTHONASYNCIODEBUG=1` (logs callbacks over 100 ms).
- Reviewing your diff: for each `await`-less call in `async def`, ask "I/O or heavy work?". If yes, pick an option above and say which and why.

## 17. Explain Every Change With the Code

**MANDATORY: finish a change by walking the user through it with the code itself. File names alone are not an explanation.**

- **When:** after any change to code, tests or config. Skip for pure docs/plan edits (list files, one line each).
- **Order:** execution flow (startup → request → teardown), not alphabetical.
- **Per file/step:** clickable link (`file.py:line`) + one-line job; the key snippet (whole function if ≤ ~30 lines); 2-4 bullets on what it does, **why**, and what it depends on.
- **Existing files:** show before/after or the added block, not "edited X".
- **Call out:** deviations from the approved plan, surprises found (not fixed unasked, Rule 3), and what was **not** verified.
- **End with** a 3-6 line arrow flow of how the pieces connect at runtime.
- Bullets and code, no essays (Rule 8). Give a deeper walkthrough only if asked.

## 18. Session Handoffs

**When context runs low or a session ends, write a handoff so a fresh conversation can continue. Capture what the next session needs, not everything that happened.**

- **Location:** `plans/handoffs/<task-name>_handoff.md` (create the folder if missing). If one exists, read it first, then update it.
- Write it proactively (at a milestone or ~60% context), not after context is lost.
- Reference, don't duplicate (link plans, issues, commits). Be specific: paths, line numbers, commit hashes, exact commands.
- Record failed approaches and why. Never include secrets (env var names only). Delete or archive when done.

```markdown
# Handoff — <task> — <YYYY-MM-DD>

## Goal
## Current state          (done / in progress at file:line / branch / env)
## What worked
## What didn't work       (approach → why it failed)
## Decisions made         (decision — reason)
## Blockers / open questions
## Next steps (in order)
## Key files & references (incl. linked plan in plans/)
## How to verify          (test/check command)
```

New-chat prompt: "Read `plans/handoffs/<task-name>_handoff.md`, summarize it back, then continue with Next steps."

## 19. The Meta-Principle

**An agent that understands its own token budget never gets stuck.**

1. Estimate before starting.
2. Checkpoint proactively.
3. Spawn subagents when the task is too large.
4. Report progress in human terms: "60% context, 40% task complete, spawning 2 subagents for the rest."

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
