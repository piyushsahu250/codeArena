import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

const UPDATED = "August 19, 2026";

export default function Privacy() {
  useSeoHead({
    title: "Privacy Policy",
    description: "How CodeArena collects, stores, and protects student and staff data — account information, proctoring signals, and certificate visibility.",
    path: "/privacy",
  });
  return (
    <MarketingPageShell eyebrow="Legal" title="Privacy Policy" intro="What data CodeArena collects, why, and how it's protected.">
      <p className="ca-mkt-updated">Last updated: {UPDATED}</p>

      <h2>Who this applies to</h2>
      <p>
        This policy covers everyone who uses CodeArena — students, staff, and administrators at
        institutes that provision accounts on the platform. There is no self-serve signup; your
        institute's administrator creates your account, so your relationship with CodeArena
        exists because of your relationship with your institute.
      </p>

      <h2>What data we collect</h2>
      <p>When your institute creates your account, and as you use the platform, we hold:</p>
      <ul>
        <li><strong>Account information</strong> — name, email, role, and (for students) registration/roll number, batch, department, and section.</li>
        <li><strong>Profile information</strong> — fields you or your institute add, such as personal and academic details, resume content, and uploaded documents.</li>
        <li><strong>Activity data</strong> — coding submissions, test attempts and scores, attendance records, learning progress, and interview/assessment sessions.</li>
        <li><strong>Proctoring signals</strong> — during a proctored test or mock interview, tab-switch events, copy-paste attempts, and (if enabled) face-presence and audio-level signals.</li>
      </ul>

      <h2>How proctoring actually works</h2>
      <p>
        Face-presence detection runs entirely in your browser using a local machine-learning
        model (TensorFlow.js) — your camera feed is never uploaded, streamed, or stored as video.
        Only the resulting signal (face present / not present, and a count of violations) is sent
        to the server and shown to your faculty. The same applies to microphone-based noise
        detection: it's informational only, computed locally, and does not record or transmit
        audio.
      </p>

      <h2>How authentication works</h2>
      <p>
        CodeArena does not use cookies to keep you signed in. Signing in issues a token (a signed
        JWT) that your browser stores locally and attaches to each request; it expires and is
        revoked on sign-out or a forced logout by your institute's admin. Passwords are hashed
        before storage — nobody at CodeArena, including staff and admins, can see your actual
        password.
      </p>

      <h2>How sensitive profile data is protected</h2>
      <p>
        Personally identifiable fields in student profiles are encrypted at rest in our database,
        not stored as plain text. Every account, password, and access-related action — password
        resets, profile edits, document verification — is written to an audit log that your
        institute's admin can review, so there's a record of who changed what.
      </p>

      <h2>Certificates are public by design</h2>
      <p>
        A course, coding assessment, or interview certificate you earn includes a verification
        page reachable via a QR code or link — this shows your name and the credential earned, so
        that someone you share the certificate with (a recruiter, for instance) can confirm it's
        genuine. This page is intentionally public for anyone holding the specific verification
        link or code, but is not indexed for general search and is not otherwise browsable.
      </p>

      <h2>Who your data is shared with</h2>
      <p>
        Your data is visible to your own institute's staff and administrators, scoped to their
        role — a staff member sees the students and classes assigned to them, not another
        institute's data. CodeArena does not sell data, and does not use third-party advertising
        or tracking scripts on the platform.
      </p>
      <p>
        Two categories of data leave our infrastructure by necessity: email delivery (welcome
        emails, password resets, notifications) is sent via a standard email provider, and, where
        an institute enables AI features (question generation, resume review, interview feedback),
        the relevant text is sent to Anthropic's Claude API to generate that feature's output. No
        student data is used to train any AI model.
      </p>

      <h2>Where data is stored</h2>
      <p>
        CodeArena's database runs on a managed PostgreSQL provider, and the application itself
        runs on standard cloud infrastructure. We don't operate our own data centers.
      </p>

      <h2>Your rights</h2>
      <p>
        You can review and update most of your own profile information directly in your account.
        For anything you can't change yourself — account deletion, a correction to academic
        records, or a data export — contact your institute's administrator, or write to us at{" "}
        <Link to="/contact">the address on our Contact page</Link>.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes materially, the "Last updated" date above will change accordingly.
        We don't backdate changes or apply them retroactively without notice.
      </p>
    </MarketingPageShell>
  );
}
