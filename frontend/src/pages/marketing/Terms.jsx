import { Link } from "react-router-dom";
import MarketingPageShell from "../../components/MarketingPageShell";
import useSeoHead from "../../hooks/useSeoHead";

const UPDATED = "August 19, 2026";

export default function Terms() {
  useSeoHead({
    title: "Terms of Service",
    description: "The terms governing use of the CodeArena platform by students, staff, and institutions.",
    path: "/terms",
  });
  return (
    <MarketingPageShell eyebrow="Legal" title="Terms of Service" intro="The terms governing your use of CodeArena.">
      <p className="ca-mkt-updated">Last updated: {UPDATED}</p>

      <h2>Accounts</h2>
      <p>
        CodeArena does not offer self-serve signup. Your account is created by your institute's
        administrator, and your right to use the platform is tied to your relationship with that
        institute. You're responsible for keeping your credentials confidential and for activity
        that happens under your account; tell your institute's admin immediately if you suspect
        unauthorized access.
      </p>

      <h2>Acceptable use</h2>
      <p>During a proctored assessment, coding practice session, or mock interview, you agree not to:</p>
      <ul>
        <li>Attempt to bypass, disable, or interfere with proctoring, timing, or grading mechanisms.</li>
        <li>Submit work that isn't your own during a graded assessment.</li>
        <li>Attempt to access, probe, or disrupt the systems that execute submitted code, or use them for any purpose other than completing your own assessments.</li>
        <li>Share your account credentials with another person, or complete an assessment on someone else's behalf.</li>
      </ul>
      <p>
        Violations detected during a proctored session (tab-switching, copy-paste, face-presence
        failures) are logged and made visible to your institute's faculty, who determine any
        consequence under their own institute's academic policy — CodeArena itself does not
        adjudicate academic integrity cases.
      </p>

      <h2>Content and ownership</h2>
      <p>
        Question banks, tests, and course content created by your institute's staff remain your
        institute's content; CodeArena provides the platform to author, run, and grade it. Code
        you submit as part of an assessment or practice session is retained as part of your
        academic record with that institute, for grading and review purposes.
      </p>

      <h2>Certificates</h2>
      <p>
        A certificate issued through CodeArena reflects that you met the specific criteria for
        that credential (a passing score, a completed course, a finished assessment) at the time
        it was issued. Certificates can be revoked by an institute administrator if issued in
        error or found to violate these terms; a revoked certificate's verification page will
        reflect that status.
      </p>

      <h2>No outcome guarantees</h2>
      <p>
        CodeArena is a practice, assessment, and preparation tool. Features like AI mock
        interviews, employability readiness scoring, and coding challenges are designed to help
        you prepare and to give your institute a consistent way to measure readiness — they are
        not a guarantee of any placement, job offer, or interview outcome. Scores and feedback
        are produced by heuristic and AI-assisted evaluation and should be treated as guidance,
        not a certified judgment of your ability.
      </p>

      <h2>Availability</h2>
      <p>
        We aim to keep CodeArena available and responsive, but like any hosted service it can
        have downtime or degraded performance. We're not liable for loss or inconvenience caused
        by a service interruption, though we take reasonable steps to minimize and disclose
        significant ones to affected institutes.
      </p>

      <h2>Account suspension</h2>
      <p>
        An institute administrator can deactivate an account at any time, including at the end of
        a student's enrollment. CodeArena may suspend accounts that violate these terms or use
        the platform in a way that risks its security or availability for other users.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If these terms change materially, the "Last updated" date above will change accordingly.
        Continued use of CodeArena after a change constitutes acceptance of the updated terms.
      </p>

      <h2>Questions</h2>
      <p>
        For anything not covered here, see our <Link to="/privacy">Privacy Policy</Link> or{" "}
        <Link to="/contact">contact us</Link>.
      </p>
    </MarketingPageShell>
  );
}
