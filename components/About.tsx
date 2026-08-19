export default function About() {
  return (
    <section className="grid w-full gap-x-10 gap-y-8 border-t border-muted/20 py-10 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
          how it works
        </h2>
        <p className="max-w-md font-sans text-sm leading-relaxed text-muted">
          Solana finalizes a block about every 400 milliseconds. Slotwave
          listens to that stream and turns each slot&apos;s transactions,
          compute and fees into sound. Anything statistically unusual comes
          through in violet.
        </p>
        <p className="max-w-md font-sans text-sm leading-relaxed text-muted">
          Replay loops a captured tape and needs no setup. Live follows mainnet
          a few seconds behind the tip through a caching proxy, so your browser
          never talks to an RPC provider directly.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
          controls
        </h2>
        <ul className="flex max-w-md flex-col gap-2 font-sans text-sm leading-relaxed text-muted">
          <li>
            <span className="font-mono text-ink">space</span>: play or pause
          </li>
          <li>
            <span className="font-mono text-ink">hover the tape</span>{" "}
            (long-press on touch): inspect any slot&apos;s transactions,
            compute and fees
          </li>
          <li>
            <span className="font-mono text-ink">wav</span>: save the last
            minute of tape as an audio file
          </li>
          <li>
            <span className="font-mono text-ink">drag the tape</span>: scrub
            like a record, playback lands wherever you let go
          </li>
          <li>
            <span className="font-mono text-ink">click the tape</span>: jump
            straight to that slot
          </li>
          <li>
            <span className="font-mono text-ink">‹ 30s / ← →</span>: skip back
            or forward. in live mode the buffer keeps a couple of minutes of
            tape recording while you listen to the past
          </li>
          <li>
            <span className="font-mono text-ink">shift + ← →</span>: step the
            inspector along the tape, slot by slot (esc dismisses it)
          </li>
          <li>
            <span className="font-mono text-ink">share</span> (or click the
            slot number): copy a link that lands the tape on that exact moment
          </li>
        </ul>
      </div>
    </section>
  );
}
