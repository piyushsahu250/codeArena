# Isolated exam network (free / low-cost design)

Goal: during a LOCKDOWN exam the exam PCs can reach only CodeArena, whatever is installed on them. This is the control that
actually blocks AI websites and search engines; the secure client's own allowlist is a second layer on top of it.

```
Exam PCs (VLAN 50, 10.50.0.0/24)
   |  DHCP gives: DNS = 10.50.0.2 (Unbound allow-list), proxy = 10.50.0.3:3128 (Squid allow-list)
   v
VLAN firewall (the college's existing switch/firewall, or a pfSense/OPNsense VM)
   - ALLOW  10.50.0.0/24  ->  10.50.0.2:53   (DNS allow-list)
   - ALLOW  10.50.0.0/24  ->  10.50.0.3:3128 (proxy allow-list)
   - ALLOW  exam PCs -> invigilator / monitoring hosts (if any)
   - DENY   everything else outbound (including direct DNS, DoH to public resolvers, and direct :443)
   v
Squid proxy -> allowlisted hosts only -> CodeArena (frontend + API), fonts, face-model CDN
```

Why three layers: DNS blocks unknown names; the proxy allows only listed destination hosts; the firewall makes sure the PC
cannot bypass either (direct IPs, DNS-over-HTTPS, VPN/tunnel ports). You do **not** have to change the whole college network:
only the switch ports (or Wi-Fi SSID) used by the exam lab join VLAN 50.

Cost: a small VM (1 vCPU / 1 GB) can run both Unbound and Squid for hundreds of PCs. Enterprise equivalents (optional):
next-gen firewall URL filtering, Cisco Umbrella / Zscaler / Cloudflare Gateway DNS policies.

Hosts to allow: `codearena.site`, `api-aws.codearena.site` (your deployment), plus the CDNs the exam page uses
(Google Fonts; the face-detection model host if camera proctoring is on). Run `node tools/list-hosts.js` (if provided) or
check the browser network tab on a pilot PC and add only what is needed.

The secure client can verify this at start-up: set `"networkAttest": "os"` in its config and it will refuse to attest
`networkRestriction` unless it cannot reach the canary hosts (google.com, chat.openai.com), proving the network, not just the client,
is blocking them.
