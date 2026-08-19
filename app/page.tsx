import type { Metadata } from "next";
import About from "@/components/About";
import Instrument from "@/components/Instrument";
import InstrumentBoundary from "@/components/InstrumentBoundary";
import VoiceLegend from "@/components/VoiceLegend";
import Wordmark from "@/components/Wordmark";
import { siteUrl } from "@/lib/site";

// The Farcaster embed is per-URL: a cast sharing /?slot=N must open the
// mini app landing on that exact slot, so the launch url echoes the param.
export async function generateMetadata({
  searchParams,
}: PageProps<"/">): Promise<Metadata> {
  const base = siteUrl();
  const params = await searchParams;
  const slotParam = typeof params.slot === "string" ? params.slot : "";
  const slot = /^\d{1,12}$/.test(slotParam) ? slotParam : null;
  return {
    other: {
      "fc:miniapp": JSON.stringify({
        version: "1",
        imageUrl: `${base}/embed-image`,
        button: {
          title: "listen",
          action: {
            type: "launch_frame",
            url: slot ? `${base}/?slot=${slot}` : base,
          },
        },
      }),
    },
  };
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center bg-background">
      <div className="flex w-full max-w-5xl flex-col px-6">
        <header className="flex items-center justify-between border-b border-muted/20 py-5">
          <Wordmark className="w-40 max-w-[60vw]" />
          <p className="hidden font-sans text-sm text-muted sm:block">
            the sound of solana, slot by slot
          </p>
        </header>

        <p className="max-w-2xl py-6 font-sans text-[15px] leading-relaxed text-muted">
          Solana seals a block roughly every 400 milliseconds. Slotwave plays
          that pulse as music: transactions set the{" "}
          <span className="text-signal">notes</span>, compute load sets the
          brightness, fees drive the bass. When something odd happens on chain,
          like a skipped slot or a compute spike, you hear it in{" "}
          <span className="text-event">violet</span>.
        </p>

        <InstrumentBoundary>
          <Instrument />
        </InstrumentBoundary>
        <VoiceLegend />
        <About />

        <footer className="flex w-full items-center justify-between border-t border-muted/20 py-6 font-mono text-xs lowercase text-muted">
          <span>
            built on{" "}
            <a
              href="https://solana.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink transition-colors hover:text-signal"
            >
              solana
            </a>{" "}
            mainnet · listening ~13s behind the tip
          </span>
          <span className="hidden sm:block">space to play/pause</span>
        </footer>
      </div>
    </main>
  );
}
