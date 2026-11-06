# Plan — Phase 3: Port pure logic (email, audio quality)

**Status:** done

## Goal

Port the two dependency-free modules first — easiest to verify, proves the Python/pytest
setup works before any LiveKit SDK code is involved.

## Steps

- [x] 1. `agent/email.py` — `PERSONAL_EMAIL_DOMAINS` set (same 10 domains) and
      `is_work_email(email: str) -> bool`, same split-on-`@`/lowercase logic as
      `../agent/src/agent/email.ts`.
      → verify: `mypy` clean (full type hints, Google docstring per `CLAUDE.md` §10).
- [x] 2. `agent/audio_quality.py` — `DEFAULT_TRANSCRIPT_CONFIDENCE_THRESHOLD = 0.6` and
      `build_audio_quality_note(noisy: bool, low_confidence: bool) -> str | None`, same
      two-sentence-parts logic as `audioQuality.ts`.
      → verify: same, plus confirm wording stays stable (tests in step 4 regex-match it).
- [x] 3. `tests/test_email.py` — mirror any TS email tests that exist, plus the asserted
      cases: work domain accepted, each personal domain rejected, case-insensitive.
      → verify: `pytest tests/test_email.py -v` all pass.
- [x] 4. `tests/test_audio_quality.py` — port all 5 cases from
      `../agent/tests/audioQuality.test.ts` 1:1 (no note when neither; both flags
      distinct from either alone; noise always mentioned; repeat requested only on low
      confidence).
      → verify: `pytest tests/test_audio_quality.py -v` all 5 pass.

## Done / Challenges / Solution

_(filled in during execution)_
