import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import api from "../api";

// Public page (no auth) — reached via a shared/copied certificate verification link.
export default function CourseCertificateVerify() {
  const { code } = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/learning/certificate/verify/${code}`).then((res) => setResult(res.data)).catch(() => setResult({ valid: false }));
  }, [code]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper, #FBF9F4)" }}>
      <div className="card" style={{ padding: 32, maxWidth: 420, textAlign: "center" }}>
        <GraduationCap size={32} />
        <h1 style={{ marginTop: 8, fontSize: "1.5em" }}>Certificate Verification</h1>
        {!result && <p className="mono" style={{ marginTop: 16 }}>Checking…</p>}
        {result && !result.valid && <p style={{ marginTop: 16, color: "var(--rust)" }}>This certificate code could not be verified.</p>}
        {result?.valid && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: "var(--mint, #4F9D6E)", fontWeight: 700 }}>✓ Valid Certificate</p>
            <p style={{ marginTop: 8 }}><strong>{result.studentName}</strong></p>
            <p className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              {result.courseName} Course Completion<br />
              Certificate ID: {result.certificateCode}<br />
              Issued: {new Date(result.issuedAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
