import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./scripts/phase2/browser-tests", timeout: 180_000, workers: 1, fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4321", headless: true, trace: "off", screenshot: "off", video: "off",
    launchOptions: process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {} },
  webServer: { command: "node scripts/phase2/browser-server.mjs", url: "http://127.0.0.1:4321/login", reuseExistingServer: false, timeout: 60_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/phase2-browser.json" }]],
});
