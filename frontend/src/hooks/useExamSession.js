import { useCallback, useEffect, useState } from "react";
import api from "../api";

// One-active-session control for secured attempts (formal tests, readiness tests, mock interviews). The server issues a session id when
// the attempt starts or resumes; every later request carries it in X-Exam-Session, and a second tab/device that kept an older id gets
// 409 SESSION_REPLACED, which flips `replaced` so the page can show a blocking message. The id is not a secret about answers.
// For attempts that start on one page and are taken on another (readiness hub -> take page) the id is handed over through
// sessionStorage, which is per-tab: a new tab never inherits it, which is exactly the point.
const key = (attemptId) => `ca_exam_session:${attemptId}`;
export const rememberExamSession = (attemptId, sessionId) => { try { if (attemptId && sessionId) sessionStorage.setItem(key(attemptId), sessionId); } catch { /* storage unavailable */ } };
export const recallExamSession = (attemptId) => { try { return sessionStorage.getItem(key(attemptId)) || null; } catch { return null; } };

export function useExamSession() {
  const [replaced, setReplaced] = useState(false);
  useEffect(() => {
    const id = api.interceptors.response.use((r) => r, (err) => {
      if (err?.response?.status === 409 && err.response.data?.code === "SESSION_REPLACED") setReplaced(true);
      return Promise.reject(err);
    });
    return () => { api.interceptors.response.eject(id); delete api.defaults.headers.common["X-Exam-Session"]; };
  }, []);
  const setSession = useCallback((sessionId) => { if (sessionId) api.defaults.headers.common["X-Exam-Session"] = sessionId; }, []);
  return { replaced, setSession };
}
