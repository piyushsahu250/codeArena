// Regression test for "a laptop with a touchscreen fails the secure-assessment device check". Pure function, no DOM.
// Run: node frontend/scripts/deviceCheckRegression.mjs
import { isMobileDevice } from "../src/utils/secureAssessment.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_DESKTOP_SITE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

check("Windows laptop WITH a touchscreen is a desktop", !isMobileDevice({ userAgent: WIN_CHROME, platform: "Win32", maxTouchPoints: 10, userAgentData: { mobile: false } }));
check("Windows laptop with touch, browser without userAgentData, is a desktop", !isMobileDevice({ userAgent: WIN_CHROME, platform: "Win32", maxTouchPoints: 10 }));
check("plain desktop is a desktop", !isMobileDevice({ userAgent: WIN_CHROME, platform: "Win32", maxTouchPoints: 0 }));
check("Mac laptop (no touch) is a desktop", !isMobileDevice({ userAgent: IPAD_DESKTOP, platform: "MacIntel", maxTouchPoints: 0 }));
check("Android phone is mobile", isMobileDevice({ userAgent: ANDROID_CHROME, platform: "Linux armv81", maxTouchPoints: 5, userAgentData: { mobile: true } }));
check("Android phone using 'Desktop site' is still mobile (browser hint)", isMobileDevice({ userAgent: ANDROID_DESKTOP_SITE, platform: "Linux x86_64", maxTouchPoints: 5, userAgentData: { mobile: true } }));
check("iPhone is mobile", isMobileDevice({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 }));
check("iPad in desktop mode (Macintosh UA, touch points) is mobile", isMobileDevice({ userAgent: IPAD_DESKTOP, platform: "MacIntel", maxTouchPoints: 5 }));
check("no navigator at all is not mobile", !isMobileDevice(null));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("device check regression: all passed");
