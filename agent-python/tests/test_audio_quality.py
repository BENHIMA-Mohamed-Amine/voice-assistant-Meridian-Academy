from agent.audio_quality import build_audio_quality_note


def test_adds_no_note_when_neither_noisy_nor_low_confidence() -> None:
    assert build_audio_quality_note(False, False) is None


def test_flags_noise_and_low_confidence_together_distinctly_from_either_alone() -> None:
    both = build_audio_quality_note(True, True)
    noisy_only = build_audio_quality_note(True, False)
    low_confidence_only = build_audio_quality_note(False, True)
    assert both is not None
    assert noisy_only is not None
    assert low_confidence_only is not None
    assert len({both, noisy_only, low_confidence_only}) == 3


def test_mentions_noise_when_the_client_reported_it_regardless_of_confidence() -> None:
    assert "noise" in (build_audio_quality_note(True, False) or "").lower()
    assert "noise" in (build_audio_quality_note(True, True) or "").lower()


def test_requests_a_repeat_when_confidence_is_low_regardless_of_the_noise_flag() -> None:
    assert "repeat" in (build_audio_quality_note(False, True) or "").lower()
    assert "repeat" in (build_audio_quality_note(True, True) or "").lower()


def test_does_not_request_a_repeat_when_confidence_is_fine_even_if_noisy() -> None:
    assert "repeat" not in (build_audio_quality_note(True, False) or "").lower()
