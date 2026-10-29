import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import api from "../api";
import Navbar from "../components/Navbar";
import ChalkUnderline from "../components/ChalkUnderline";
import CertificateShareBar from "../components/CertificateShareBar";

export default function CourseCertificate() {
  const { slug } = useParams();
  const [cert, setCert] = useState(null);
  const [error, setError] = useState("");
  const [notOffered, setNotOffered] = useState(false); // the course has its certificate switched off: no "complete every lesson" hint, there is nothing to unlock
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get(`/learning/courses/${slug}/certificate`)
      .then((res) => setCert(res.data))
      .catch((err) => {
        setNotOffered(err.response?.data?.code === "CERTIFICATE_NOT_OFFERED");
        setError(err.response?.data?.error || "Failed to load certificate");
      });
  }, [slug]);

  async function download() {
    setDownloading(true);
    try {
      const { data } = await api.get(`/learning/courses/${slug}/certificate/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}-certificate.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download certificate");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>Certificate</h1>
            <ChalkUnderline />
          </div>
          <Link to={`/learning/${slug}`} className="btn btn-ghost">← Course</Link>
        </div>

        {error && (
          <div className="card" style={{ padding: 24, marginTop: 24, textAlign: "center", color: "var(--ink-dim)" }}>
            {notOffered ? error : `${error} — complete every lesson in this course to unlock your certificate.`}
          </div>
        )}

        {cert && (
          <div className="card" style={{ padding: 32, marginTop: 24, textAlign: "center" }}>
            <GraduationCap size={40} />
            <h2 style={{ marginTop: 12 }}>{cert.courseName} Course Completion</h2>
            <p style={{ marginTop: 8 }}>Awarded to <strong>{cert.studentName}</strong></p>
            <p className="mono" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 12 }}>
              Certificate ID: {cert.certificateCode}<br />
              Issued: {new Date(cert.issuedAt).toLocaleDateString()}
            </p>
            <CertificateShareBar
              verifyUrl={`${window.location.origin}/learning/certificate/verify/${cert.certificateCode}`}
              downloadFn={download}
              downloading={downloading}
              studentName={cert.studentName}
              credentialName={`${cert.courseName} Course Completion Certificate`}
              issueDate={cert.issuedAt}
              certificateCode={cert.certificateCode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
