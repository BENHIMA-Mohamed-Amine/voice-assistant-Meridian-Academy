# syntax=docker/dockerfile:1

# Use the official uv image, which bundles a pinned Python + uv for reproducible builds
ARG PYTHON_VERSION=3.12
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS base

ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV HOME="/app"

# Install ca-certificates (the system CA bundle used for TLS), then clean the apt
# cache. Required by the LiveKit SDK: the native Rust core reads the system trust
# store at runtime, which the slim base image doesn't ship.
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*

# --- Build stage ---
FROM base AS build

WORKDIR /app

# Copy just the dependency files first, for more efficient layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies (no project code yet, no dev dependencies)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Pre-download any ML models the agent needs (e.g. Silero VAD weights). This runs
# before COPY . . so the download layer is cached across code-only changes.
COPY src/ ./src/
RUN uv run python src/main.py download-files

# Install the project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- Production stage ---
FROM base

# Create a non-privileged user that the app will run under
ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

WORKDIR /app

COPY --from=build --chown=appuser:appuser /app /app

USER appuser

ENV PATH="/app/.venv/bin:$PATH"

# Run the application. "start" tells the worker to connect to LiveKit and begin
# waiting for jobs.
CMD ["python", "src/main.py", "start"]
