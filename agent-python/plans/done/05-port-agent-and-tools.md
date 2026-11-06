# Plan — Phase 5: Port the agent + tool

**Status:** done

## Goal

Port the assistant's instructions, LLM wiring (now via the phase-2 factory, not a direct
import), and the `notifySupportTeam` tool — behavior identical to the TS version.

## Steps

- [x] 1. `agent/tools.py` — `notify_support_team` as an `@function_tool`-decorated async
      function. Same parameters (`company_name`, `service_interest` optional,
      `work_email` required), same validation order (reject personal email first), same
      Slack webhook POST (fire-and-forget — schedule via `asyncio.create_task`, don't
      `await` it inline, per `CLAUDE.md` §16), same return strings (`"success"` /
      rejection message).
      → verify: unit test — personal email rejected without a webhook call attempted;
      work email with webhook unset logs and still returns `"success"`.
- [x] 2. `agent/agent.py` — `create_agent(is_environment_noisy, on_turn_confidence,
      get_confidence_threshold) -> Agent`. Instructions block copied verbatim (prompt
      text is language-agnostic). `llm=create_llm()` from the phase-2 factory, not a
      direct `openai.LLM(...)` call — this is the one call site that must prove the
      Open/Closed seam works.
      → verify: `mypy` clean; manually diff the instructions string against the TS
      source, character for character.
- [x] 3. `on_user_turn_completed` async hook — same confidence/noise/threshold read
      order, same `logger.info` equivalent of the `console.log('turn audio quality', ...)`
      line, same note-injection call into `build_audio_quality_note`.
      → verify: unit test drives `on_user_turn_completed` with a fake chat context,
      asserts a message is appended only when noisy or low-confidence.

## Done / Challenges / Solution

_(filled in during execution)_
