# Manual QA checklist (things automation here cannot cover)

Run on a **real phone** (Android Chrome + iPhone Safari if possible) and one desktop browser, using
a test student, a test staff/admin and a test clerk account. ~30 minutes.

## Student, on a phone
- [ ] Log in; dashboard fits the screen, no sideways scrolling.
- [ ] Open **Readiness Hub** -> start the DSA test. The proctored setup screen appears; camera/mic
      prompts work; "Begin Assessment" enters fullscreen (iPhone Safari may not support fullscreen --
      confirm the amber banner is clear and the test still works).
- [ ] Answer an MCQ (auto-saves, "Saved" indicator updates). Write code; switch language Java <-> Python
      -> each language keeps its own starter/code, never the other language's.
- [ ] Switch tab / exit fullscreen -> a warning appears; at the limit the attempt terminates and the
      report shows the "terminated" banner. No score or "correct/incorrect" is visible mid-test.
- [ ] Let the timer run out on a spare attempt -> it submits itself and lands on the report.
- [ ] Submit normally -> report loads; **Download PDF** works.
- [ ] Formal test and module coding assessment: type, Run, Submit, final Submit all work on a phone.
- [ ] Inputs do not cause the page to zoom when tapped (iPhone).

## Admin / staff, desktop (and a quick look on a phone)
- [ ] **Test results page** -> "Download results (Excel)" saves a real .xlsx; numbers are numbers,
      roll/PRN keep leading zeros; the CSV button opens correctly in Excel (names not garbled).
- [ ] With a roll filter typed, the download only contains matching rows and the note is shown.
- [ ] Coding assessment attempts -> Export downloads; a bad id shows a readable error, not nothing.
- [ ] Result Management: bulk-import preview, then confirm, with a ~500-row file; re-upload updates marks.
- [ ] Attendance report with a very wide date range shows the "first N records" notice and the
      download buttons still give the full file.
- [ ] Readiness Subjects form: the "Proctored" box, webcam/mic, max violations save and persist.
- [ ] Readiness analytics no longer include a terminated attempt.

## Clerk
- [ ] Clerk dashboard loads on desktop and phone; clerk can enter/import marks for their institute only.
- [ ] Clerk cannot open another institute's exam by URL (expect an error page, not data).

## AI (needs a working Gemini key)
- [ ] Generate 5 MCQs in a row from the question bank; all succeed, most show "Verified".
- [ ] Run one AI mock interview end to end (intro, next question, evaluation).
