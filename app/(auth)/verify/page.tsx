export default function VerifyPage() {
  return (
    <main>
      <p className="eyebrow">One more step</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk">
        Check your email
      </h1>
      <span aria-hidden className="barre mt-6 opacity-40" />

      <p className="mt-8 leading-relaxed text-mirror">
        We sent you a confirmation link. Open it to finish setting up your
        account, then sign in.
      </p>
      <p className="mt-4 text-sm text-barre">
        The link can take a minute to arrive. Check your spam folder if it does
        not.
      </p>
    </main>
  );
}
