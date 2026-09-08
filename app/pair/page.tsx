"use client";

import { FormEvent, useEffect, useState } from "react";

export default function PairDisplayPage() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "approving" | "approved" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supplied = new URLSearchParams(window.location.search).get("code") ?? "";
    const timer = window.setTimeout(() => {
      setCode(supplied.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code || state === "approving") return;
    setState("approving");
    setMessage("");
    try {
      const response = await fetch("/api/device-pair", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Display could not be authorised");
      setState("approved");
      setMessage("Display authorised. It will open automatically and remain authorised for three months.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Display could not be authorised");
    }
  }

  return (
    <main className="access-shell">
      <form className="access-card pairing-approval-card" onSubmit={approve}>
        <div className="access-kicker">BIOENGINEERING LAB · BITZ</div>
        <h1>Authorise wall display</h1>
        <p>Confirm the code shown on the monitor.</p>

        <label htmlFor="pairing-code">Display code</label>
        <input
          id="pairing-code"
          name="code"
          type="text"
          inputMode="text"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10))}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
        />

        {message ? <div className={state === "approved" ? "pairing-success" : "access-error"} role="status">{message}</div> : null}
        <button type="submit" disabled={!code || state === "approving" || state === "approved"}>
          {state === "approving" ? "AUTHORISING…" : state === "approved" ? "AUTHORISED" : "AUTHORISE DISPLAY"}
        </button>
      </form>
    </main>
  );
}
