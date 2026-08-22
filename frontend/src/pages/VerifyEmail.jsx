import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api";

// Reached from the link inside the "confirm your new email" mail sent by PATCH /users/me. No form
// here -- the token in the URL is the whole input, so verification fires once automatically. Not
// gated behind being logged in as the account in question: the link may be opened on a different
// device than the one the change was requested from (e.g. checking a personal inbox on a phone).
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState(token ? "verifying" : "missing"); // verifying | success | error | missing
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    api.post("/auth/verify-email", { token })
      .then((res) => {
        setStatus("success");
        setMessage(res.data.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.response?.data?.error || "Failed to verify email");
      });
  }, [token]);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px", minHeight: "100vh", background: "var(--paper)" }}>
      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <h2>Confirm email address</h2>

        {status === "missing" && (
          <p style={{ fontSize: 14, marginTop: 16 }}>This link is missing its token. Request the email change again from Account Settings.</p>
        )}
        {status === "verifying" && (
          <p style={{ color: "var(--ink-dim)", fontSize: 14, marginTop: 16 }}>Confirming…</p>
        )}
        {status === "success" && (
          <>
            <p style={{ color: "var(--mint)", fontSize: 14, marginTop: 16 }}>{message}</p>
            <Link to="/login" className="btn btn-primary" style={{ display: "inline-block", marginTop: 18, padding: "10px 24px" }}>Sign in</Link>
          </>
        )}
        {status === "error" && (
          <p style={{ color: "var(--rust)", fontSize: 14, marginTop: 16 }}>{message}</p>
        )}
      </div>
    </div>
  );
}
