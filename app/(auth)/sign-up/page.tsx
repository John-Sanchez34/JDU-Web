"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await signUp.email({
      name: String(data.get("name")),
      email: String(data.get("email")),
      password: String(data.get("password")),
    });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create your account.");
      return;
    }
    router.push("/verify");
  }

  return (
    <main>
      {/* One account covers the whole family — worth saying before they start. */}
      <p className="eyebrow">One account per family</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk">
        Create account
      </h1>
      <span aria-hidden className="barre mt-6 opacity-40" />

      <form onSubmit={handleSubmit} className="mt-10 space-y-6">
        <label className="block">
          <span className="label">Your name</span>
          <input name="name" required autoComplete="name" className="input" />
        </label>

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
            minLength={10}
            autoComplete="new-password"
            className="input"
          />
          <span className="hint">At least 10 characters.</span>
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
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-sm text-mirror">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
