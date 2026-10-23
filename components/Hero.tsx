"use client";

// The top of the page. Copy rules: imperative headline in plain words, one primary action, nothing we can't back up
// (no "trusted by" counts): the badge and steps only state what the product really does.
import { useRef } from "react";

const BOT_URL = "https://t.me/bestpopilot_bot";

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
  // A native <dialog> gives us a focus trap, Escape-to-close and screen-reader semantics for free.
  const chooser = useRef<HTMLDialogElement>(null);
  const close = () => chooser.current?.close();

  // Closing the box hands focus back to the button that opened it, which would pull the page back up. So close first,
  // wait one frame, then scroll to the target and move keyboard focus there.
  function goTo(id: string) {
    close();
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      el.focus({ preventScroll: true });
      history.replaceState(null, "", `#${id}`);
    });
  }

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
            <button type="button" className="btn-hero btn-hero-primary" onClick={() => chooser.current?.showModal()}>
              Try a sample message
            </button>
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

      <dialog
        ref={chooser}
        className="chooser"
        aria-labelledby="chooser-title"
        onClick={(e) => { if (e.target === chooser.current) close(); }} // a click on the dimmed backdrop closes it
      >
        <h2 id="chooser-title" className="chooser-title">How do you want to send a vendor message?</h2>

        <a className="chooser-option" href="#parser" onClick={(e) => { e.preventDefault(); goTo("parser"); }}>
          <span className="chooser-num" aria-hidden="true">1</span>
          <span>
            <strong>Paste or forward a message here</strong>
            <span className="chooser-desc">Go to the Update parser and paste a vendor&rsquo;s message or a voice-note transcript.</span>
          </span>
        </a>

        <a className="chooser-option" href={BOT_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
          <span className="chooser-num" aria-hidden="true">2</span>
          <span>
            <strong>Use the Telegram bot</strong>
            <span className="chooser-desc">Opens the POPilot bot in Telegram (new tab). It only answers people who have been added.</span>
          </span>
        </a>

        <button type="button" className="chooser-cancel" onClick={close}>Cancel</button>
      </dialog>
    </>
  );
}
