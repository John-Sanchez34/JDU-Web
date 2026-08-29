import { RetryDeliveryButton } from "@/components/retry-delivery-button";
import { db } from "@/db";
import { listRetriableDeliveries } from "@/db/queries/email-deliveries";
import { requireStaff } from "@/lib/guards";

export default async function AdminEmailsPage() {
  await requireStaff();
  const deliveries = await listRetriableDeliveries(db);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Email</h2>
      <p className="hint mt-2">
        Messages that did not go out. Nothing retries on its own — press Retry
        once you believe the problem is fixed. Pressing it twice is safe.
      </p>

      {deliveries.length === 0 ? (
        <p className="mt-8 text-mirror">Everything has been delivered.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex flex-wrap items-start justify-between gap-4 p-5"
            >
              <div>
                <p className="font-semibold text-chalk">{delivery.subject}</p>
                <p className="mt-1 text-sm text-mirror">
                  {delivery.recipientEmail} · {delivery.template}
                </p>
                <p className="tabular mt-2 text-sm text-alarm">
                  {delivery.status === "failed"
                    ? (delivery.error ?? "Failed with no reason recorded")
                    : "Started sending and never finished"}
                  {delivery.attempts > 1 && ` · ${delivery.attempts} attempts`}
                </p>
              </div>
              <RetryDeliveryButton
                deliveryId={delivery.id}
                recipientEmail={delivery.recipientEmail}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
