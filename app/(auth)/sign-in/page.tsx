"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await signIn.email({
      email: String(data.get("email")),
      password: String(data.get("password")),
    });

    setPending(false);
    if (result.error) {
      // Deliberately vague: never reveal whether an email is registered.
      setError("That email and password combination did not work.");
      return;
    }
    router.push("/portal");
  }

  return (
    <main>
      <p className="eyebrow">Welcome back</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk">Sign in</h1>
      <span aria-hidden className="barre mt-6 opacity-40" />

      <form onSubmit={handleSubmit} className="mt-10 space-y-6">
        <label className="block">
          <span className="label">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="input"
          />
        </label>

        <label className="block">
          <span className="label">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-alarm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-solid w-full disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-8 text-sm text-mirror">
        New to the studio?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Create an account
        </Link>
      </p>
    </main>
  );
}
