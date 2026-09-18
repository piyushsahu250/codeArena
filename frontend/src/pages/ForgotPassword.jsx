import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email });
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "64px 24px", minHeight: "100vh", background: "var(--paper)" }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380 }}>
        <h2>Forgot password</h2>
        <p style={{ color: "var(--ink-dim)", fontSize: 14, marginTop: -4 }}>
          Enter your account email and we'll send you a link to reset your password.
        </p>

        <label style={labelStyle} htmlFor="forgot-email">Email</label>
        <input id="forgot-email" style={inputStyle} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@codearena.edu.in" />

        {error && <p style={{ color: "var(--rust)", fontSize: 13, marginTop: 8 }}>{error}</p>}
        {message && <p style={{ color: "var(--mint)", fontSize: 13, marginTop: 8 }}>{message}</p>}

        <button className="btn btn-primary" style={{ width: "100%", marginTop: 18, padding: "12px 0" }} disabled={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </button>

        <p style={{ marginTop: 20, fontSize: 14, color: "var(--ink-dim)" }}>
          <Link to="/login" style={{ color: "var(--amber-dark)", fontWeight: 600 }}>Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };
