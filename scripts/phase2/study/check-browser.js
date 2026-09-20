// Run in the synthetic study page through agent-browser eval --stdin.
// This is automated technical evidence, never a human speed-study result.
window.__phase2Check = { status: "RUNNING" };
void (async () => {
  const get = id => document.getElementById(id);
  const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
  const waitFor = async predicate => {
    const deadline = performance.now() + 55_000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error("Study did not settle");
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  };
  get("cancel").click(); get("clear-results").click(); get("observer").value = "automated";
  assert(performance.getEntriesByType("resource").every(entry => !entry.name.includes("/local-ai-assets/")), "Assets acquired before explicit click");
  const network = { fetch: 0, xhr: 0, beacon: 0, websocket: 0, eventsource: 0, forbidden: 0 };
  const nativeFetch = window.fetch.bind(window);
  const checkRequest = input => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || url.search || !url.pathname.startsWith("/local-ai-assets/") ||
        (input instanceof Request && input.method !== "GET")) {
      network.forbidden++; throw new Error("Unapproved study network request");
    }
  };
  window.fetch = (input, init) => { network.fetch++; checkRequest(input);
    if (init?.body || (init?.method && init.method !== "GET")) { network.forbidden++; throw new Error("Network body forbidden"); }
    return nativeFetch(input, init);
  };
  const NativeXhr = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends NativeXhr {
    open(method, url, ...rest) { network.xhr++; checkRequest(url); assert(method === "GET", "XHR write forbidden"); super.open(method, url, ...rest); }
  };
  navigator.sendBeacon = () => { network.beacon++; return false; };
  window.WebSocket = class { constructor() { network.websocket++; throw new Error("WebSocket forbidden"); } };
  window.EventSource = class { constructor() { network.eventsource++; throw new Error("EventSource forbidden"); } };
  const NativeWorker = window.Worker;
  let activeWorkers = 0; let failNer = false;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      if (failNer && String(url).includes("ner.worker.js")) throw new Error("synthetic private failure payload");
      super(url, options); activeWorkers++; this.wasTerminated = false;
    }
    terminate() { if (!this.wasTerminated) { this.wasTerminated = true; activeWorkers--; } return super.terminate(); }
  };
  const technical = [];
  for (const option of get("sheet").options) {
    get("sheet").value = option.value; get("sheet").dispatchEvent(new Event("change"));
    get("ocr").click();
    await waitFor(() => !get("review").hidden || !get("ocr").disabled);
    assert(!get("review").hidden, "OCR or mandatory NER did not complete");
    assert(document.activeElement === get("review-title"), "Review focus missing");
    const count = get("rows").children.length;
    const expectedWords = [...get("rows").querySelectorAll("input[type=text]")].map(input => input.value);
    const checkboxes = [...get("rows").querySelectorAll("input[type=checkbox]")];
    checkboxes.forEach(input => { input.checked = true; });
    get("confirm").click();
    assert(get("review").hidden && get("rows").children.length === 0, "Confirmation retained content");
    const record = JSON.parse(get("results").textContent).at(-1);
    technical.push({ worksheetId: option.value, candidateCount: count, expectedCount: record.expectedCount,
      allWordsRecovered: count === record.expectedCount, stages: record });
    get("manual").click();
    [...get("rows").querySelectorAll("input[type=text]")].forEach((input, i) => { input.value = expectedWords[i] ?? ""; });
    get("confirm").click();
    assert(get("review").hidden && !get("rows").children.length, "Manual confirmation failed");
    technical.at(-1).manualTechnicalRecord = JSON.parse(get("results").textContent).at(-1);
  }
  get("manual").click();
  get("rows").querySelector("input[type=text]").value = "private@example.invalid";
  get("confirm").click();
  assert(!get("review").hidden, "Out-of-corpus edit was accepted");
  get("cancel").click();
  assert(get("review").hidden && !get("rows").children.length && get("worksheet").width === 0, "Cancellation retained content");
  get("ocr").click(); get("cancel").click();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert(get("review").hidden && !get("rows").children.length, "Cancelled work resurfaced");
  failNer = true;
  get("ocr").click();
  await waitFor(() => !get("ocr").disabled);
  failNer = false;
  assert(get("review").hidden && !get("rows").children.length, "Worker failure exposed candidates");
  assert(!document.body.textContent.includes("synthetic private failure payload"), "Error details escaped");
  const paths = performance.getEntriesByType("resource").map(entry => new URL(entry.name));
  assert(paths.every(url => url.origin === location.origin &&
    (url.pathname.startsWith("/local-ai-assets/") || ["/study.css", "/study.js", "/ner.worker.js", "/favicon.ico"].includes(url.pathname))), "Unexpected network resource");
  assert(activeWorkers === 0, "Workers retained after completion or failure");
  assert(network.forbidden + network.beacon + network.websocket + network.eventsource === 0, "Forbidden network attempts");
  return { status: "TECHNICAL_CHECK_ONLY", technical, cancel: true, workerFailure: true, network, activeWorkers,
    outOfCorpusEditRejected: true, resources: [...new Set(paths.map(url => url.pathname))],
    productValueGate: "NOT_EVALUATED", fullPrivacyPolicy: "NOT_IMPLEMENTED" };
})().then(result => { window.__phase2Check = result; }).catch(error => {
  window.__phase2Check = { status: "FAILED", reason: error.message };
});
