import Link from "next/link";
import { requireStaff } from "@/lib/guards";

const links = [
  { href: "/admin/seasons", label: "Seasons" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/", label: "Back to site" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaff();

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">
            {user.email} · {user.role}
          </p>
          <h1 className="display mt-3 text-3xl uppercase text-chalk sm:text-4xl">
            Studio admin
          </h1>
        </div>
        <nav aria-label="Admin" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
