import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trophy } from "lucide-react";
import api from "../api";
import "./interviewPrep.css";

// Public page (no auth) — reached by scanning the QR code on a printed/downloaded certificate.
export default function InterviewVerify() {
  const { code } = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/interview/certificate/verify/${code}`).then((res) => setResult(res.data)).catch(() => setResult({ valid: false }));
  }, [code]);

  return (
    <div className="interview-prep" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="ip-glass" style={{ padding: 32, maxWidth: 420, textAlign: "center" }}>
        <Trophy size={32} />
        <h1 style={{ marginTop: 8, fontSize: "1.5em" }}>Certificate Verification</h1>
        {!result && <p className="mono" style={{ marginTop: 16 }}>Checking…</p>}
        {result && !result.valid && <p style={{ marginTop: 16, color: "var(--rust)" }}>This certificate code could not be verified.</p>}
        {result?.valid && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: "var(--ip-accent)", fontWeight: 700 }}>✓ Valid Certificate</p>
            <p style={{ marginTop: 8 }}><strong>{result.studentName}</strong></p>
            <p className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              Average Score: {result.averageScore}%<br />
              Certificate ID: {result.certificateCode}<br />
              Issued: {new Date(result.issuedAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
