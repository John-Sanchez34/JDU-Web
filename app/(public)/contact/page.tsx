import type { Metadata } from "next";
import { HoursList } from "@/components/hours-list";
import { studio, studioPhoneHref } from "@/content/studio";

export const metadata: Metadata = {
  title: "Contact",
  description: `Phone, email, address, and hours for ${studio.name}.`,
};

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <p className="eyebrow">Come by, or call ahead</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk sm:text-5xl">
        Contact us
      </h1>
      <span aria-hidden className="barre mt-8 opacity-40" />

      <div className="mt-12 grid gap-12 sm:grid-cols-2">
        <section>
          <h2 className="eyebrow">Phone</h2>
          <p className="mt-3">
            <a
              href={studioPhoneHref}
              className="tabular text-lg text-chalk transition-colors hover:text-maple"
            >
              {studio.phone}
            </a>
          </p>
        </section>

        <section>
          <h2 className="eyebrow">Email</h2>
          <p className="mt-3">
            <a
              href={`mailto:${studio.email}`}
              className="text-lg text-chalk transition-colors hover:text-maple"
            >
              {studio.email}
            </a>
          </p>
        </section>

        <section>
          <h2 className="eyebrow">Address</h2>
          <address className="mt-3 text-lg not-italic text-chalk">
            {studio.address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </section>

        <section>
          <h2 className="eyebrow">Hours</h2>
          <div className="mt-3">
            <HoursList />
          </div>
        </section>
      </div>
    </main>
  );
}
