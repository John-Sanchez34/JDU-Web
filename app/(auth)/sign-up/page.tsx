"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Create your family account</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input name="name" required autoComplete="name"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="email"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input name="password" type="password" required minLength={10}
            autoComplete="new-password"
            className="mt-1 w-full rounded border px-3 py-2" />
          <span className="mt-1 block text-xs text-gray-600">
            At least 10 characters.
          </span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
