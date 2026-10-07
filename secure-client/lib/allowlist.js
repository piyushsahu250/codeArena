// Navigation / network allowlist used by the secure client (client layer). The authoritative network restriction for a
// LOCKDOWN exam is the exam network (firewall / proxy / DNS, see ../network/); this is the in-client layer on top of it.
"use strict";

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

// allowedHosts entries: "codearena.site" (exact host), "*.codearena.site" (any subdomain, not the bare domain).
function hostAllowed(host, allowedHosts) {
  if (!host) return false;
  return allowedHosts.some((rule) => {
    const r = String(rule).toLowerCase();
    if (r.startsWith("*.")) return host.endsWith(r.slice(1)) && host.length > r.length - 1;
    return host === r;
  });
}

function isAllowedUrl(url, allowedHosts) {
  const u = String(url || "");
  if (u.startsWith("devtools:") || u.startsWith("chrome:") || u.startsWith("file:") || u.startsWith("view-source:")) return false;
  if (u.startsWith("data:") || u.startsWith("blob:")) return true; // inline assets the page itself creates (fonts, workers, camera preview)
  let parsed; try { parsed = new URL(u); } catch { return false; }
  if (!["https:", "http:", "wss:", "ws:"].includes(parsed.protocol)) return false;
  return hostAllowed(parsed.hostname.toLowerCase(), allowedHosts);
}

// Process names that must not be running during a LOCKDOWN exam (AppLocker/Assigned Access are what really prevent them from
// starting; the client reports it if one is seen anyway). Matching is by lower-case executable name.
const DEFAULT_BLOCKED_PROCESSES = [
  "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "iexplore.exe",
  "code.exe", "devenv.exe", "idea64.exe", "pycharm64.exe", "eclipse.exe", "notepad++.exe", "notepad.exe", "sublime_text.exe",
  "cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "bash.exe", "wsl.exe",
  "chatgpt.exe", "claude.exe", "copilot.exe", "perplexity.exe", "gemini.exe", "cursor.exe",
  "teamviewer.exe", "anydesk.exe", "obs64.exe", "obs32.exe", "discord.exe", "telegram.exe", "whatsapp.exe", "snippingtool.exe", "screenclippinghost.exe",
];

function findBlockedProcesses(processNames, blocked = DEFAULT_BLOCKED_PROCESSES, ownExe = "") {
  const own = String(ownExe).toLowerCase();
  const set = new Set(blocked.map((b) => b.toLowerCase()));
  return [...new Set(processNames.map((p) => String(p).toLowerCase()).filter((p) => set.has(p) && p !== own))];
}

module.exports = { hostOf, hostAllowed, isAllowedUrl, DEFAULT_BLOCKED_PROCESSES, findBlockedProcesses };
