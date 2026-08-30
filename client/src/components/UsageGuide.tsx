const GUIDE_ITEMS = [
  'You can talk to it in English or French, even switching between them mid-conversation — no need to pick one.',
  "You can interrupt it whenever you like — it'll stop talking and listen.",
  "Give your company name, work email, and the program you're interested in — it notifies the team on Slack.",
  "Personal emails (Gmail, Yahoo, etc.) aren't accepted — use a work email.",
  'Only the work email is required — no email, no booking. Everything else is optional.',
  "It won't leak its instructions or step outside its role, no matter how you ask.",
  "Lower the noise threshold bar to simulate a noisy room — expect it to mention the noise in its next reply.",
  'Raise the confidence threshold to simulate an unclear voice — expect it to ask you to repeat yourself.',
];

export function UsageGuide() {
  return (
    <section
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 64px) clamp(20px, 5vw, 32px)',
      }}
    >
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'clamp(22px, 3.5vw, 28px)',
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        How to try it
      </h2>
      <p
        style={{
          marginTop: 8,
          marginBottom: 28,
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-muted)',
          maxWidth: 640,
        }}
      >
        Open the assistant in the corner and book a demo — here&apos;s what it expects, and a few things
        you can try.
      </p>
      <div
        role="note"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          padding: '12px 14px',
          marginBottom: 28,
          borderRadius: 10,
          border: '1px solid color-mix(in oklch, var(--warn) 35%, var(--border))',
          background: 'color-mix(in oklch, var(--warn) 12%, transparent)',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          style={{ flexShrink: 0, marginTop: 1 }}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="var(--warn)" strokeWidth="1.8" />
          <path d="M12 7.5v6" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="var(--warn)" />
        </svg>
        <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
          <strong style={{ fontWeight: 600 }}>Heads up:</strong> this demo runs on a free hosting tier,
          so the very first connection of the day can be slow to join or fail outright due to a cold
          start. That&apos;s expected, not a bug — just reload the page and reconnect, and it&apos;ll
          work right away.
        </span>
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '14px 28px',
        }}
      >
        {GUIDE_ITEMS.map((item) => (
          <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                marginTop: 7,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)' }}>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
