import { describe, expect, it } from 'vitest';
import { buildAudioQualityNote } from './audioQuality.ts';

describe('buildAudioQualityNote', () => {
  it('adds no note when neither noisy nor low-confidence', () => {
    expect(buildAudioQualityNote(false, false)).toBeUndefined();
  });

  it('flags noise-and-low-confidence together, distinctly from either alone', () => {
    const both = buildAudioQualityNote(true, true);
    const noisyOnly = buildAudioQualityNote(true, false);
    const lowConfidenceOnly = buildAudioQualityNote(false, true);
    expect(both).toBeDefined();
    expect(noisyOnly).toBeDefined();
    expect(lowConfidenceOnly).toBeDefined();
    expect(new Set([both, noisyOnly, lowConfidenceOnly]).size).toBe(3);
  });

  it('mentions noise when the client reported it, regardless of confidence', () => {
    expect(buildAudioQualityNote(true, false)).toMatch(/noise|noisy/i);
    expect(buildAudioQualityNote(true, true)).toMatch(/noise|noisy/i);
  });

  it('requests a repeat when confidence is low, regardless of the noise flag', () => {
    expect(buildAudioQualityNote(false, true)).toMatch(/repeat/i);
    expect(buildAudioQualityNote(true, true)).toMatch(/repeat/i);
  });

  it('does not request a repeat when confidence is fine, even if noisy', () => {
    expect(buildAudioQualityNote(true, false)).not.toMatch(/repeat/i);
  });
});
