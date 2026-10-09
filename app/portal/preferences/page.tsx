import { BroadcastPreferenceForm } from "@/components/broadcast-preference-form";
import { db } from "@/db";
import { findUserById } from "@/db/queries/users";
import { requireUser } from "@/lib/guards";

export default async function PreferencesPage() {
  const sessionUser = await requireUser();
  const account = await findUserById(db, sessionUser.id);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Email preferences</h2>
      <p className="hint mt-2">
        Studio news only. Messages about your own enrollment requests and about a
        cancelled class always go out.
      </p>
      <BroadcastPreferenceForm optedOut={account?.broadcastOptedOutAt != null} />
    </section>
  );
}
