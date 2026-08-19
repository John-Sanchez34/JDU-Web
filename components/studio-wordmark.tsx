import Image from "next/image";
import Link from "next/link";
import { studio } from "@/content/studio";
import logo from "@/public/logo-jdu.png";

/**
 * The mark and the studio name set as one lockup.
 *
 * The mark itself carries no alt text. The name sits immediately beside it, so
 * describing the image too would announce the studio name twice. The mark is
 * also served in chalk rather than its original black, which would vanish
 * against the floor.
 */
export function StudioWordmark({
  href,
  markClassName = "h-11 w-auto",
  textClassName = "text-base sm:text-lg",
  priority = false,
}: {
  /** Renders the lockup as a link when set. */
  href?: string;
  markClassName?: string;
  textClassName?: string;
  priority?: boolean;
}) {
  const lockup = (
    <>
      <Image
        src={logo}
        alt=""
        aria-hidden
        priority={priority}
        className={markClassName}
      />
      <span
        className={`display uppercase leading-tight tracking-tight text-chalk ${textClassName}`}
      >
        {studio.name}
      </span>
    </>
  );

  if (!href) {
    return <div className="flex items-center gap-3">{lockup}</div>;
  }

  return (
    <Link href={href} className="flex items-center gap-3">
      {lockup}
    </Link>
  );
}
