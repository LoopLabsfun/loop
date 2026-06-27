"use client";

import { useEffect } from "react";

// Last-resort boundary for a throw in the ROOT layout itself. It replaces the
// whole document, so it must render its own <html>/<body> and can't rely on
// globals.css or Tailwind being applied — styles are inlined with the brand
// tokens (canvas #fcfcfd, ink #16131a, accent #5b34d6).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#fcfcfd",
          color: "#16131a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 24px",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#5b34d6", marginBottom: 8 }}>something broke</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Loop hit a snag</h1>
        <p style={{ fontSize: 14.5, color: "#6b6675", maxWidth: 420, lineHeight: 1.6, margin: "0 0 28px" }}>
          Something went wrong loading the page. Try again, or head back home.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={reset}
            style={{ fontSize: 14, fontWeight: 600, padding: "11px 20px", borderRadius: 10, background: "#5b34d6", color: "#fff", border: "none", cursor: "pointer" }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ fontSize: 14, fontWeight: 600, padding: "11px 20px", borderRadius: 10, background: "#fff", color: "#16131a", border: "1px solid #e3e0e7", textDecoration: "none" }}
          >
            Back home
          </a>
        </div>
        {error.digest && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#9b95a4", marginTop: 32 }}>ref: {error.digest}</div>}
      </body>
    </html>
  );
}
