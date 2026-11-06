# Plan — Phase 9: Docs & cutover

**Status:** approved

## Goal

Document the new backend, then retire the TypeScript one — the last, irreversible step.

## Steps

- [x] 1. `README.md` in `agent-python/` — project structure, tech choices (same
      providers, now via the factory), env vars, local setup, the provider-swap how-to
      written in phase 2's `docs/architecture.md`.
- [x] 2. `docs/silent-bug-risks.md` — carries over the TS limitations note (in README's
      Known Limitations section) and documents issues found during the port itself:
      the `prewarm()` HTTP-context gotcha, Groq's free-tier rate limit on multi-turn
      tests, `ChatMessage.metrics` being a dict (not an object), and the GPT-Live
      dropped-turn/catch-up-slot invariant in `turn_pairing.py`.
- [ ] 3. **Stop and confirm with the user before this step** — it's destructive and
      irreversible: delete `../agent/` (TS source, tests, `node_modules`, lockfiles) and
      rename `agent-python/` → `agent/`.
      → verify: `git status` reviewed, nothing valuable lost; only proceed on explicit
      go-ahead, per the safety rules on destructive/hard-to-reverse actions.
- [ ] 4. Final smoke test post-rename: `lk agent dev` still starts from the renamed
      `agent/` path, client still connects, booking flow still works end to end.

## Done / Challenges / Solution

_(filled in during execution)_
