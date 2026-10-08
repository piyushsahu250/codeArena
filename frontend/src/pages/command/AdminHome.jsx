import { lazy, Suspense } from "react";
import { useAuth } from "../../context/AuthContext";
import InstituteCommand from "./InstituteCommand";

const SuperAdminCommand = lazy(() => import("./SuperAdminCommand"));

// Platform-level accounts (no institute) get the global command center; anyone bound to an
// institute gets that institute's dashboard. The backend enforces the same split independently.
export default function AdminHome() {
  const { user } = useAuth();
  if (user?.instituteId) return <InstituteCommand />;
  return <Suspense fallback={null}><SuperAdminCommand /></Suspense>;
}
