"""Optional Langfuse OpenTelemetry trace export for per-session observability."""

from __future__ import annotations

import base64
import os
from typing import Any


def setup_langfuse_tracing(metadata: dict[str, Any] | None = None) -> Any | None:
    """Export the agent's per-session OpenTelemetry traces (LLM calls, tool calls,
    STT/TTS spans) to Langfuse, if the LANGFUSE_* env vars are set.

    Skipped entirely if they aren't -- same pattern as the optional Slack webhook.
    Unlike Node.js, Python's `set_tracer_provider` keeps Agent insights in LiveKit
    Cloud working automatically; no extra fanout wiring is needed here.

    Returns:
        The constructed TracerProvider (call `.force_flush()` on shutdown), or None.
    """
    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY")
    base_url = os.environ.get("LANGFUSE_BASE_URL")

    if not public_key or not secret_key or not base_url:
        return None

    from livekit.agents.telemetry import set_tracer_provider
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    auth = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
    os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = f"{base_url.rstrip('/')}/api/public/otel"
    # Opts into Langfuse's realtime ingestion; without it spans can take up to 10
    # minutes to appear.
    os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = (
        f"Authorization=Basic {auth},x-langfuse-ingestion-version=4"
    )

    trace_provider = TracerProvider()
    trace_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(trace_provider, metadata=metadata)
    return trace_provider
