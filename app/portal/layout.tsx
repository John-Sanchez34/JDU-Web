import Link from "next/link";
import { requireUser } from "@/lib/guards";

const links = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/students", label: "Students" },
  { href: "/portal/enrollments", label: "Classes" },
  { href: "/", label: "Back to site" },
];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Signed in as {user.email}</p>
          <h1 className="display mt-3 text-3xl uppercase text-chalk sm:text-4xl">
            My account
          </h1>
        </div>
        <nav aria-label="Portal" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-mirror transition-colors hover:text-chalk"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <span aria-hidden className="barre mt-6 opacity-40" />

      <div className="mt-10">{children}</div>
    </div>
  );
}
