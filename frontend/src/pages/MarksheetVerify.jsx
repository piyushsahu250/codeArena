import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import api from "../api";

// Public page (no auth) — mirrors CertificateVerify.jsx exactly, for the marksheet verification
// code embedded in a marksheet's QR code / "Marksheet ID".
export default function MarksheetVerify() {
  const { code } = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/results/verify/${code}`).then((res) => setResult(res.data)).catch(() => setResult({ valid: false }));
  }, [code]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper, #FBF9F4)", padding: 24 }}>
      <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
        <ClipboardList size={32} />
        <h2 style={{ marginTop: 8 }}>Marksheet Verification</h2>

        {!result && <p className="mono" style={{ marginTop: 16 }}>Checking…</p>}

        {result && !result.valid && (
          <p style={{ marginTop: 16, color: "var(--rust)" }}>{result.error || "This marksheet ID could not be verified."}</p>
        )}

        {result?.valid && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: "var(--mint, #4F9D6E)", fontWeight: 700 }}>✓ Valid Marksheet</p>
            <p style={{ marginTop: 8 }}><strong>{result.studentName}</strong></p>
            {result.institute && <p style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{result.institute}</p>}
            <p className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              {result.examinationTitle}<br />
              Marks: {result.obtainedMarks} / {result.totalMarks} ({result.percentage}%)<br />
              Result: {result.result}<br />
              Marksheet ID: {result.verificationCode}<br />
              {result.publishedAt && <>Published: {new Date(result.publishedAt).toLocaleDateString()}<br /></>}
              Verified: {new Date(result.verificationTimestamp).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
