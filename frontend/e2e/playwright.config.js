// Everything runs against localhost: the SPA is served by `vite preview` (built with no VITE_API_URL, so it talks to http://localhost:4000/api)
// and the backend is the local container. Accounts are disposable (backend/scripts/e2eSeed.js).
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  // Fake camera/microphone so the proctored interview screens can be exercised without hardware (no real media is captured).
  use: { baseURL: "http://localhost:5173", headless: true, viewport: { width: 1280, height: 800 }, trace: "off", screenshot: "only-on-failure", permissions: ["camera", "microphone"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } },
  outputDir: "./test-results",
});
