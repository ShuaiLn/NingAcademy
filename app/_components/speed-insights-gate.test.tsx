// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({path:"/student",render:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>state.path}));
vi.mock("@vercel/speed-insights/next",()=>({SpeedInsights:()=>{state.render();return null;}}));
import { SpeedInsightsGate, isOcrImportPath, SPEED_INSIGHTS_ENABLED } from "./speed-insights-gate";
afterEach(cleanup);
it("uses the global-disable fallback for direct loads and client transitions",()=>{
  expect(SPEED_INSIGHTS_ENABLED).toBe(false); const view=render(<SpeedInsightsGate/>);
  state.path="/student/personal-english/import"; view.rerender(<SpeedInsightsGate/>);
  state.path="/student"; view.rerender(<SpeedInsightsGate/>); expect(state.render).not.toHaveBeenCalled();
  expect(isOcrImportPath("/student/personal-english/import/")).toBe(true);
});
