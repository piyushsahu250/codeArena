import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import api from "../api";

// Public page (no auth) — unified verification for the Certificate model (LEARNING_MODULE /
// CODING_ASSESSMENT / MANUAL). AI Mock Interview certificates keep using their own separate
// verify page (InterviewVerify.jsx) since they live on a different model with a working flow
// already — this page only needs to cover what's new.
export default function CertificateVerify() {
  const { code } = useParams();
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/certificates/verify/${code}`).then((res) => setResult(res.data)).catch(() => setResult({ valid: false }));
  }, [code]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper, #FBF9F4)", padding: 24 }}>
      <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
        <GraduationCap size={32} />
        <h1 style={{ marginTop: 8, fontSize: "1.5em" }}>Certificate Verification</h1>

        {!result && <p className="mono" style={{ marginTop: 16 }}>Checking…</p>}

        {result && !result.valid && (
          <p style={{ marginTop: 16, color: "var(--rust)" }}>{result.error || "This certificate code could not be verified."}</p>
        )}

        {result?.valid && result.revoked && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: "var(--rust)", fontWeight: 700, fontSize: 16 }}>This certificate has been revoked and is no longer valid.</p>
            <p className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
              Certificate ID: {result.certificateCode}<br />
              Verification checked: {new Date(result.verificationTimestamp).toLocaleString()}
            </p>
          </div>
        )}

        {result?.valid && !result.revoked && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: "var(--mint, #4F9D6E)", fontWeight: 700 }}>✓ Valid Certificate</p>
            <p style={{ marginTop: 8 }}><strong>{result.studentName}</strong></p>
            {result.institute && <p style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{result.institute}</p>}
            <p className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              {result.programName}<br />
              Certificate ID: {result.certificateCode}<br />
              Completed: {new Date(result.completionDate).toLocaleDateString()}<br />
              Issued by: {result.issuedBy}<br />
              Verified: {new Date(result.verificationTimestamp).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
