import type { EnrollmentStatus } from "@/db/schema";

const LABELS: Record<EnrollmentStatus, string> = {
  pending: "Requested — bring payment to the studio",
  active: "Enrolled",
  withdrawn: "Withdrawn",
  released: "Released",
};

const TONES: Record<EnrollmentStatus, string> = {
  pending: "text-maple",
  active: "text-chalk",
  withdrawn: "text-mirror",
  released: "text-mirror",
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border border-barre/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide ${TONES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
