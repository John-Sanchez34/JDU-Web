import Link from "next/link";
import { HoursList } from "@/components/hours-list";
import { studio } from "@/content/studio";

export default function HomePage() {
  return (
    <main>
      <section className="mirror-glare border-b border-barre/25">
        <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
          {/* The count-in. Every class on this floor starts on eight. */}
          <p aria-hidden className="eyebrow tabular rise">
            5 · 6 · 7 · 8
          </p>
          <h1
            className="rise display mt-6 max-w-2xl text-5xl uppercase text-chalk sm:text-7xl"
            style={{ animationDelay: "120ms" }}
          >
            {studio.heroHeadline}
          </h1>
          <span
            aria-hidden
            className="barre barre-draw mt-10 max-w-2xl"
            style={{ animationDelay: "300ms" }}
          />
          <p
            className="rise mt-8 max-w-xl text-lg leading-relaxed text-mirror"
            style={{ animationDelay: "420ms" }}
          >
            {studio.tagline}
          </p>
          <div
            className="rise mt-10 flex flex-wrap gap-4"
            style={{ animationDelay: "520ms" }}
          >
            <Link href="/classes" className="btn btn-solid">
              Browse classes
            </Link>
            <Link href="/schedule" className="btn btn-ghost">
              See the schedule
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <p className="eyebrow">Studio hours</p>
        <span aria-hidden className="barre mt-3 opacity-40" />
        <div className="mt-8 max-w-md">
          <HoursList />
        </div>
        <p className="mt-8 text-sm text-mirror">
          Questions about placement or age groups?{" "}
          <Link
            href="/contact"
            className="font-medium text-maple transition-colors hover:text-chalk"
          >
            Get in touch
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
