// The top of the page. Copy rules: imperative headline in plain words, one primary action, nothing we can't back up
// (no "trusted by" counts): the badge and steps only state what the product really does.
const STEPS = [
  "Forward a text or voice note",
  "The right PO updates",
  "You get a stock-out alert",
];

function Check() {
  return (
    <svg className="hero-badge-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3.2 8.6l3 3 6.6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M8 3v9m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Hero() {
  return (
    <>
      <a className="skip-link" href="#parser">Skip to the update parser</a>
      <header className="hero">
        <div className="hero-inner">
          <p className="hero-badge">
            <Check />
            Reads Hinglish text and voice notes
          </p>

          <h1 className="hero-title">Forward or connect your vendor&rsquo;s chat.</h1>
          <p className="hero-sub">See which PO moved and whether you&rsquo;ll run out of stock.</p>

          <div className="hero-actions">
            <a className="btn-hero btn-hero-primary" href="#parser">Try a sample message</a>
            <a className="btn-hero btn-hero-secondary" href="#board">
              See your PO board
              <ArrowDown />
            </a>
          </div>

          <p className="hero-note">Unclear messages wait for your one-tap confirm. Nothing changes on a guess.</p>

          <ol className="hero-steps" aria-label="How POPilot works">
            {STEPS.map((s, i) => (
              <li key={s}>
                <span className="hero-step-num" aria-hidden="true">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </header>
    </>
  );
}
