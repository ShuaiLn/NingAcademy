// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), confirm: vi.fn(), clear: vi.fn() }));
vi.mock("@/app/_lib/ocr-import/pipeline", () => ({ importPhoto: mocks.run }));
vi.mock("@/app/actions/personal-word-ocr", () => ({ confirmOcrWordsBulk: mocks.confirm }));
vi.mock("@/app/_lib/local-ai/model-cache", () => ({ createBrowserModelCache: () => ({ clearModel: mocks.clear }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { OcrImportClient } from "./ocr-import-client";
const review = { removedLineCount: 1, safeWords: ["read", "write"], sanitizedText: "Read the book.", candidates: [
  { id: "one", term: "read", confidence: 96, dictionary: "known", state: "normal", selected: true, disposition: "full_offer", exampleSentence: "Read the book." },
  { id: "two", term: "write", confidence: 60, dictionary: "known", state: "must_review", selected: false, disposition: "word_only", exampleSentence: null },
] };
async function process() {
  fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [new File(["synthetic"], "private-name.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "开始本地识别" }));
  await screen.findByRole("heading", { name: "确认要保存的生词" });
}
beforeEach(() => { mocks.run.mockReset().mockResolvedValue(structuredClone(review)); mocks.confirm.mockReset().mockResolvedValue({ ok: false }); mocks.clear.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
describe("learner import lifecycle", () => {
  it("does no inference before explicit click and focuses review", async () => {
    render(<OcrImportClient />); expect(mocks.run).not.toHaveBeenCalled(); await process();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "确认要保存的生词" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(5); // two words + meanings, only one permitted example
    expect(screen.getByLabelText("OCR 置信度 96.0")).toBeTruthy();
    expect(screen.getAllByLabelText("词典状态：词典已收录")).toHaveLength(2);
    expect(screen.queryByText(/private-name/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Send once|仅本次发送/);
  });
  it("only sends selected confirmed fields; unchanged retry UUID reused, edit rotates", async () => {
    render(<OcrImportClient />); await process();
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "确认并导入 1 个生词" }));
    submit(); await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert"); submit(); await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[0][0]).toBe(mocks.confirm.mock.calls[1][0]);
    expect(mocks.confirm.mock.calls[0][1]).toEqual([{ term: "read", meaning: null, exampleSentence: "Read the book." }]);
    fireEvent.change(screen.getAllByLabelText("生词")[0], { target: { value: "reading" } });
    submit(); await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(3));
    expect(mocks.confirm.mock.calls[2][0]).not.toBe(mocks.confirm.mock.calls[0][0]);
  });
  it("word_only cannot submit an example and failures never expose internal text", async () => {
    mocks.confirm.mockRejectedValue(new Error("raw-private-text")); render(<OcrImportClient />); await process();
    fireEvent.click(screen.getByLabelText("保存第 1 个生词")); fireEvent.click(screen.getByLabelText("保存第 2 个生词"));
    fireEvent.click(screen.getByRole("button", { name: "确认并导入 1 个生词" })); await screen.findByRole("alert");
    expect(mocks.confirm.mock.calls[0][1]).toEqual([{ term: "write", meaning: null, exampleSentence: null }]);
    expect(document.body.textContent).not.toContain("raw-private-text");
  });
  it("success clears review; double click submits once", async () => {
    let resolve!: (value: {ok:boolean;count:number}) => void;
    mocks.confirm.mockImplementation(() => new Promise(done => { resolve=done; })); render(<OcrImportClient />); await process();
    const button=screen.getByRole("button",{name:"确认并导入 1 个生词"}); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledTimes(1); await act(async()=>resolve({ok:true,count:1}));
    expect(screen.queryByRole("heading",{name:"确认要保存的生词"})).toBeNull(); expect(screen.getByRole("status").textContent).toContain("已导入 1");
  });
  it("cancel, pagehide and unmount abort the active generation and ignore late results", async () => {
    let resolve!: (value: unknown) => void;
    mocks.run.mockImplementation(()=>new Promise(done=>{resolve=done;})); const rendered=render(<OcrImportClient />);
    fireEvent.change(screen.getByLabelText("选择图片"),{target:{files:[new File(["x"],"x.png")]}});
    fireEvent.click(screen.getByRole("button",{name:"开始本地识别"}));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    const signal=mocks.run.mock.calls[0][1]; fireEvent.click(screen.getByRole("button",{name:"取消并清除"})); expect(signal.aborted).toBe(true);
    await act(async()=>resolve(review)); expect(screen.queryByRole("heading",{name:"确认要保存的生词"})).toBeNull();
    rendered.unmount();
  });
  it("pagehide clears review and recovery cannot resurrect it", async () => {
    render(<OcrImportClient />); await process(); fireEvent(window,new Event("pagehide"));
    expect(screen.queryByRole("heading",{name:"确认要保存的生词"})).toBeNull();
    fireEvent(window,new Event("pageshow")); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it.each([
    ["term", "Name: John"],
    ["meaning", "Member ID: A1234"],
    ["example", "learner@example.invalid"],
  ])("refuses user-edited PII in the %s field before the action", async (field, value) => {
    render(<OcrImportClient />); await process();
    const input = field === "term" ? screen.getAllByLabelText("生词")[0]
      : field === "meaning" ? screen.getAllByLabelText("释义（可选，最多 1000 字）")[0]
      : screen.getByLabelText("例句（可选，最多 2000 字）");
    fireEvent.change(input,{target:{value}});
    fireEvent.click(screen.getByRole("button",{name:"确认并导入 1 个生词"})); expect(mocks.confirm).not.toHaveBeenCalled(); await screen.findByRole("alert");
  });
});
