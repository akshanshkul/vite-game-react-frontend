import { useState } from "react";
import { flushCompletions, mergeProgress } from "../services/sync";
import { api, request } from "../services/api";
import { googleIdToken } from "../services/google";
import { db, type Profile } from "../services/storage";
import { play } from "../services/feedback";
import { Icon } from "../ui/icons";
import type { User } from "../../packages/contracts/src/api";
export default function Account({
  profile,
  user,
  onUser,
  onMerge,
  onAdmin,
  onOnline,
}: {
  profile: Profile;
  user: User | null;
  onUser: (u: User | null) => void;
  onMerge: (p: Profile) => void;
  onAdmin: () => void;
  onOnline: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(profile.name),
    [reveal, setReveal] = useState(false),
    [message, setMessage] = useState(
      "Optional account. Guest play stays available offline.",
    ),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(false);
    try {
      await fn();
    } catch (e) {
      setError(true);
      play("blocked");
      setMessage(e instanceof Error ? e.message : "Service unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function signedIn(u: User, text: string) {
    await db.meta.put({ id: "signedIn", value: true });
    onUser(u);
    setPassword("");
    setMessage(text);
    play("match");
  }
  async function sync() {
    await db.meta.put({ id: "syncEnabled", value: true });
    const items = await flushCompletions();
    onMerge(mergeProgress(profile, items));
    setMessage(
      "Completed progress synced. Your active local board was kept separate. Automatic retries are enabled on reconnect; guest coins stay separate from server currency.",
    );
  }
  const note = (
    <p className={`form-note ${error ? "error" : ""}`} aria-live="polite">
      {message}
    </p>
  );
  if (!user)
    return (
      <section className="auth">
        <button
          type="button"
          className="google-button block"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              signedIn(
                (await api.google(await googleIdToken())).user,
                "Signed in with Google. You can sync completed guest progress.",
              ),
            )
          }
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
            <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
          </svg>
          Continue with Google
        </button>
        <div className="or" aria-hidden="true">
          <span>or use email</span>
        </div>
        <div className="segmented" role="tablist" aria-label="Account mode">
          {(
            [
              ["signin", "Sign in"],
              ["signup", "Sign up"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? "active" : ""}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {note}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (mode === "signin")
                await signedIn(
                  (await api.login(email, password)).user,
                  "Signed in. You can sync completed guest progress.",
                );
              else
                await signedIn(
                  (await api.register(email, password, name.trim() || profile.name))
                    .user,
                  "Account created. Sync when you are ready.",
                );
            });
          }}
        >
          {mode === "signup" && (
            <label className="field">
              <span>Display name</span>
              <input
                maxLength={40}
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              inputMode="email"
              autoComplete={mode === "signin" ? "username" : "email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type={reveal ? "text" : "password"}
              required
              minLength={12}
              maxLength={128}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
          >
            <Icon name={reveal ? "eyeOff" : "eye"} size={16} />
            {reveal ? "Hide password" : "Show password"}
          </button>
          {mode === "signup" && (
            <small className="hint-text">At least 12 characters.</small>
          )}
          <button className="primary block" disabled={busy}>
            {busy ? (
              <span className="spinner" aria-hidden="true" />
            ) : mode === "signin" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </form>
        <button
          type="button"
          className="ghost block"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              signedIn((await api.me()).user, "Session restored."),
            )
          }
        >
          Restore session
        </button>
      </section>
    );
  return (
    <section className="auth">
      <div className="account-card">
        <div className="avatar" aria-hidden="true">
          {user.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <strong>Signed in as {user.display_name}</strong>
          <small>
            {user.email}
            {user.role === "admin" ? " · admin" : ""}
          </small>
        </div>
      </div>
      {note}
      <div className="stack">
        <button className="primary block" disabled={busy} onClick={() => void run(sync)}>
          Sync completed progress
        </button>
        <button className="block" disabled={busy} onClick={onOnline}>
          Start this level as a verified online run
        </button>
        {user.role === "admin" && (
          <button className="block" onClick={onAdmin}>
            Admin dashboard
          </button>
        )}
        <button
          className="block"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await request("me/export");
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(result, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "zen-cloud-export.json";
              link.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          Export cloud data
        </button>
        <button
          className="block"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await db.meta.put({ id: "syncEnabled", value: false });
              await db.meta.put({ id: "signedIn", value: false });
              await api.logout();
              onUser(null);
              setMessage("Signed out. Your local progress is kept.");
            })
          }
        >
          Sign out
        </button>
      </div>
      <details className="danger">
        <summary>Delete cloud account</summary>
        <label className="field">
          <span>Confirm password to delete account</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          className="danger-button block"
          disabled={busy || !password}
          onClick={() =>
            void run(async () => {
              if (
                !confirm(
                  "Permanently delete your cloud account? Local progress stays on this device.",
                )
              )
                return;
              await request("me", { password }, "DELETE");
              await db.meta.put({ id: "signedIn", value: false });
              onUser(null);
              setPassword("");
              setMessage("Cloud account deleted.");
            })
          }
        >
          Delete cloud account
        </button>
      </details>
    </section>
  );
}
