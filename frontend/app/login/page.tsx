"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const { token, login, logout } = useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const api = process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:4000";

  async function signup(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${api}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: email.split("@")[0],
          email,
          password,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Signup failed");
      login(json.token as string);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Signup failed");
    }
  }

  async function doLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${api}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Login failed");
      login(json.token as string);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    }
  }

  async function loadMe(tok = token) {
    setError(null);
    setMe(null);
    try {
      const res = await fetch(`${api}/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Load me failed");
      setMe(json.user);
    } catch (err: any) {
      setError(err.message || "Load me failed");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md bg-white rounded shadow border p-6">
        <h1 className="text-xl font-semibold text-center">Readerly</h1>

        <div className="mt-4 flex rounded overflow-hidden border">
          <button
            className={`flex-1 px-4 py-2 text-sm ${
              mode === "login" ? "bg-blue-600 text-white" : "bg-gray-100"
            }`}
            onClick={() => setMode("login")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`flex-1 px-4 py-2 text-sm ${
              mode === "signup" ? "bg-blue-600 text-white" : "bg-gray-100"
            }`}
            onClick={() => setMode("signup")}
            type="button"
          >
            Create account
          </button>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) =>
            mode === "login" ? void doLogin(e) : void signup(e)
          }
        >
          <div className="space-y-1">
            <label className="block text-sm">Email</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Password</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {error}
            </div>
          )}

          <button
            className="w-full bg-blue-600 text-white px-4 py-2 rounded"
            type="submit"
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <a className="text-sm text-blue-700 hover:underline" href="/">
            ← Back to app
          </a>
        </div>
      </div>
    </main>
  );
}
