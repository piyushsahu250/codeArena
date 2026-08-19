import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

export default function Contact() {
  useSeoHead({
    title: "Contact",
    description: "Get in touch with the CodeArena team — for institutions evaluating the platform, existing users, or general questions.",
    path: "/contact",
  });
  return (
    <MarketingPageShell
      eyebrow="Contact"
      title="Get in touch."
      intro="For institutions evaluating CodeArena, existing users with a question, or anything else."
    >
      <h2>Email</h2>
      <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17 }}>
        <Mail size={18} />
        <a href="mailto:codearena001@gmail.com">codearena001@gmail.com</a>
      </p>
      <p>
        This is the same address CodeArena's own notification emails (welcome emails, password
        resets, result announcements) are sent from — replying to any of those, or writing in
        directly, reaches the same inbox.
      </p>

      <h2>If you're a student or staff member</h2>
      <p>
        Accounts on CodeArena are created by your institute's administrator — there's no
        self-serve signup. If you've forgotten your password or can't sign in, use the{" "}
        <Link to="/login">Sign in</Link> page's "Forgot password?" link first; if that doesn't
        resolve it, your institute's admin or your faculty can reset your account directly.
        General product questions can also be sent to the address above.
      </p>

      <h2>If you're evaluating CodeArena for an institution</h2>
      <p>
        See <Link to="/for-institutions">what CodeArena offers institutions</Link> for a full
        breakdown of the admin and staff-facing features — student management, attendance,
        assessments, the question bank, and reporting — then reach out by email with any
        questions about onboarding your institute.
      </p>
    </MarketingPageShell>
  );
}
