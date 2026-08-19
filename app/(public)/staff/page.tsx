import type { Metadata } from "next";
import { studio } from "@/content/studio";

export const metadata: Metadata = {
  title: "Staff",
  description: `The instructors and directors at ${studio.name}.`,
};

export default function StaffPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <p className="eyebrow">Who you will meet</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk sm:text-5xl">
        Our staff
      </h1>
      <span aria-hidden className="barre mt-8 opacity-40" />

      {/* Everyone in the room holds the same barre, so each entry hangs off one. */}
      <ul className="mt-12 grid gap-x-12 gap-y-12 sm:grid-cols-2">
        {studio.staff.map((member) => (
          <li key={member.name}>
            <span aria-hidden className="barre w-12 bg-maple" />
            <h2 className="mt-5 text-xl font-semibold text-chalk">
              {member.name}
            </h2>
            <p className="eyebrow mt-1 text-mirror">{member.title}</p>
            <p className="mt-4 leading-relaxed text-mirror">{member.bio}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
