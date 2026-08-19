import Link from "next/link";
import { getSessionUser } from "@/lib/guards";
import { StudioWordmark } from "@/components/studio-wordmark";

const links = [
  { href: "/classes", label: "Classes" },
  { href: "/schedule", label: "Schedule" },
  { href: "/staff", label: "Staff" },
  { href: "/contact", label: "Contact" },
];

/**
 * A nav link marks itself with a short barre that slides out from the left on
 * hover and on keyboard focus — the same gesture as the hero rule, at nav
 * scale.
 */
function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group relative inline-block py-1 text-mirror transition-colors hover:text-chalk focus-visible:text-chalk"
    >
      {label}
      <span
        aria-hidden
        className="barre absolute inset-x-0 -bottom-px origin-left scale-x-0 bg-maple transition-transform duration-200 ease-out group-hover:scale-x-100 group-focus-visible:scale-x-100"
      />
    </Link>
  );
}

export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="border-b border-barre/25">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
      >
        <StudioWordmark
          href="/"
          priority
          markClassName="h-24 w-auto"
          textClassName="text-lg sm:text-xl"
        />
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <NavLink {...link} />
            </li>
          ))}
          <li>
            <Link
              href={user ? "/portal" : "/sign-in"}
              className="font-semibold text-maple transition-colors hover:text-chalk"
            >
              {user ? "My account" : "Sign in"}
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
