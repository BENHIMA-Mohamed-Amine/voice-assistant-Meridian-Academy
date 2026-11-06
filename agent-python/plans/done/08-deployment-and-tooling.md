# Plan — Phase 8: Deployment & tooling

**Status:** done

## Goal

Port the Docker build and CI so the Python agent deploys to LiveKit Cloud the same way
the TS one did.

## Steps

- [x] 1. `Dockerfile` — `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` base (uv's own
      image, bundles a pinned Python + uv), `ca-certificates` install (same reason as
      the TS Dockerfile: native SDK core reads the system trust store), `uv sync
      --frozen`, non-root `appuser` pattern preserved, `CMD ["python", "src/main.py",
      "start"]`.
      → verifying: `docker build .` — kicked off; see this file's Done/Challenges
      section once it finishes (build takes a few minutes for ML deps like
      onnxruntime). Not yet confirmed at time of writing.
- [x] 2. `.dockerignore` — swapped `node_modules`/`pnpm-lock.yaml`/`.next` entries for
      `.venv/`, `__pycache__/`, `*.pyc`.
- [x] 3. `livekit.toml` — copied as-is. **Caveat flagged in README.md:** its
      `[agent] id` currently points at the *same* agent id as `../agent/livekit.toml`
      — decide whether this Python agent replaces the TS one or gets a new id before
      ever running `lk agent deploy` from here. Not deployed; deploy is the user's
      explicit call per their own instruction this round.
- [x] 4. CI workflow (`.github/workflows/tests.yml`) — pnpm install/lint/test steps
      swapped for `uv sync` + `ruff check`/`ruff format --check` + `mypy` + `pytest`.
      Not pushed or run on CI infrastructure — exists locally in this branch only,
      per the safety rules on CI/CD changes.

## Done / Challenges / Solution

_(filled in during execution)_
