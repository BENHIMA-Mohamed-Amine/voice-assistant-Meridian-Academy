"""Unit tests for the provider/pipeline Strategy + Factory registries."""

import pytest

from providers.factory import create_pipeline
from providers.llm import create_llm
from providers.pipeline import CascadePipeline, SpeechToSpeechPipeline
from providers.stt import create_stt
from providers.tts import create_tts


def test_create_pipeline_defaults_to_cascade(monkeypatch) -> None:
    monkeypatch.delenv("PIPELINE_ARCHITECTURE", raising=False)
    assert isinstance(create_pipeline(), CascadePipeline)


def test_create_pipeline_honors_realtime_selection(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_ARCHITECTURE", "realtime")
    assert isinstance(create_pipeline(), SpeechToSpeechPipeline)


def test_create_pipeline_rejects_unknown_architecture(monkeypatch) -> None:
    monkeypatch.setenv("PIPELINE_ARCHITECTURE", "nonsense")
    with pytest.raises(ValueError, match="Unknown PIPELINE_ARCHITECTURE"):
        create_pipeline()


def test_create_stt_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "nonsense")
    with pytest.raises(ValueError, match="Unknown STT_PROVIDER"):
        create_stt()


def test_create_tts_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setenv("TTS_PROVIDER", "nonsense")
    with pytest.raises(ValueError, match="Unknown TTS_PROVIDER"):
        create_tts()


def test_create_llm_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "nonsense")
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        create_llm()


def test_create_stt_requires_api_key(monkeypatch) -> None:
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    with pytest.raises(ValueError, match="DEEPGRAM_API_KEY"):
        create_stt()
