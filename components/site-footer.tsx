import { StudioWordmark } from "@/components/studio-wordmark";
import { studio, studioPhoneHref } from "@/content/studio";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-barre/25">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 text-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <StudioWordmark markClassName="h-14 w-auto" textClassName="text-lg" />
          <address className="mt-4 not-italic text-mirror">
            {studio.address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </div>
        <div className="text-mirror">
          <p>
            <a
              href={studioPhoneHref}
              className="tabular transition-colors hover:text-maple"
            >
              {studio.phone}
            </a>
          </p>
          <p className="mt-1">
            <a
              href={`mailto:${studio.email}`}
              className="transition-colors hover:text-maple"
            >
              {studio.email}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
