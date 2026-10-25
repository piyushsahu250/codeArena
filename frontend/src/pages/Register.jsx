import { Navigate } from "react-router-dom";

// There is no self-registration: accounts are created by an institute administrator. Anyone who opens /register (an old link, a bookmark) is sent to the sign-in page, which explains this in
// the page itself. This used to show a browser alert() before redirecting: a modal pop-up that blocks the page, cannot be styled or read reliably by assistive technology, and is suppressed
// entirely by some browsers.
export default function Register() {
  return <Navigate to="/login?notice=registration" replace />;
}
