# Phase 0 third-party license and redistribution review

Date: 2026-09-13. This is a technical compliance inventory, not legal advice.
It covers only the retained Phase 0 browser runtimes and assets. No conclusion
below authorizes a production distribution while an item is marked unresolved.

## Retained components

| Component actually used | Pinned version/source | License evidence | Redistribution obligations relevant here | Source-disclosure trigger | Phase 0 conclusion |
| --- | --- | --- | --- | --- | --- |
| Tesseract.js | npm `tesseract.js@7.0.0` | Installed `package.json` and `LICENSE.md`; upstream repository declares Apache-2.0 | Include Apache-2.0 license, retain applicable notices, and mark modified files | No general source-disclosure requirement | Verified, subject to shipping third-party notices |
| Tesseract.js core | npm `tesseract.js-core@7.0.0` | Installed `package.json` and `LICENSE`; upstream repository declares Apache-2.0 | Same Apache-2.0 obligations | No general source-disclosure requirement | Verified, subject to shipping third-party notices |
| English trained data | Project Naptha `tessdata` `4.0.0_fast/eng.traineddata.gz`; local SHA-256 `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91` | Project Naptha tessdata repository declares Apache-2.0 and explicitly documents self-hosting | Same Apache-2.0 obligations | No general source-disclosure requirement | Verified, subject to shipping third-party notices |
| NeuroBERT NER source model | `boltuix/NeuroBERT-NER`, source revision observed as `fdc13cd31d4abc10b1b54df348caf10727a1ad93` | Hugging Face card metadata declares Apache-2.0 | Same Apache-2.0 obligations for the source model | No general source-disclosure requirement | Source-model license identified |
| NeuroBERT ONNX conversion | `onnx-community/NeuroBERT-NER-ONNX@e3a6a290e438a506d2ba7bbb0f5875b7f034cebf` | Pinned conversion card names the Apache-2.0 source model, but the conversion repository has neither a `license` card field nor a `LICENSE` file | The derived ONNX distribution should carry the source model's Apache-2.0 license/attribution; conversion-specific terms are not stated | No Apache source-disclosure requirement, but the missing conversion-repository license statement requires owner/legal confirmation | **Unresolved provenance/notice uncertainty**; do not call redistribution fully approved yet |
| Transformers.js browser runtime | npm `@huggingface/transformers@4.2.0` | Installed `package.json` and `LICENSE` declare Apache-2.0 | Same Apache-2.0 obligations | No general source-disclosure requirement | Verified for the browser code path, subject to shipping third-party notices |
| ONNX Runtime Web | npm `onnxruntime-web@1.26.0-dev.20260416-b7804b056c` | Installed package metadata/license and Microsoft ONNX Runtime repository declare MIT | Preserve copyright and MIT permission notice in distributed copies/substantial portions | No source-disclosure requirement | Verified, subject to shipping third-party notices |
| KittenTTS Nano INT8 weights and voices | `KittenML/kitten-tts-nano-0.8-int8@84781d74e29ee25217551556398b42f80593a813` | Pinned model card declares Apache-2.0 | Same Apache-2.0 obligations | No general source-disclosure requirement | Verified, subject to shipping third-party notices |
| Kitten browser wrapper | npm `kitten-tts-webgpu@0.1.1`, npm git head `1e65d24b54ef9f5538b130c41ce0185abdccf630` | The installed npm artifact's `package.json` and bundled `LICENSE` declare MIT. The current upstream repository instead describes its code as Apache-2.0, so the evidence must remain version-specific. | For the installed 0.1.1 artifact, preserve its MIT copyright and license | No MIT source-disclosure requirement by itself | Wrapper license identified; embedded components below remain controlling |
| `phonemizer@1.2.1` package wrapper | npm git head `6835144b7ee9043129222549c1ed2f6a27216278` | Installed `package.json` and `LICENSE` declare Apache-2.0 | Same Apache-2.0 obligations for original wrapper code | No Apache source-disclosure requirement by itself | Wrapper license identified; embedded eSpeak remains controlling |
| eSpeak NG code, rules, dictionary/data embedded by the phonemizer/Kitten bundle | Actual production TTS Worker chunk contains `eSpeakNGWorker` and eSpeak WASM/fallback code; upstream Kitten credits eSpeak dictionary/rules as GPL-3.0; eSpeak NG states GPL-3.0-or-later | eSpeak NG `COPYING`/repository and Kitten upstream credits | Distribution requires a GPL license copy and Corresponding Source availability. Depending on the legal characterization of the single generated browser Worker bundle, GPL terms may extend beyond the eSpeak portion. The installed Kitten/phonemizer npm artifacts do not themselves ship an eSpeak GPL notice or Corresponding Source offer. | **Yes for the GPL-covered eSpeak code/data and modifications; possible broader combined-work effect requires counsel** | **Unresolved legal blocker for the present single-bundle/self-hosted distribution** |

## Bundle facts that control the TTS result

- The production TTS Worker chunk is 1,430,256 bytes raw in the measured build.
  It contains compiled `eSpeakNGWorker` bindings plus the eSpeak dictionary/rule
  fallback. This is not a merely optional package present in `node_modules`; it
  is in the browser-delivered artifact used before Kitten inference.
- The generated chunk does not carry readable MIT, Apache-2.0, or GNU GPL
  license text. A coincidental `GPL` byte sequence inside compressed/base64 data
  is not a license notice.
- Self-hosting the model does not remove the eSpeak obligations because the
  browser receives the combined Worker code. Running inference locally affects
  privacy, not whether distribution occurred.
- The model weights are Apache-2.0 and are not the source of this blocker.

## Required compliance action before deployment

1. Create a production third-party notices distribution containing every
   applicable MIT and Apache-2.0 notice and attribution for the exact shipped
   artifacts.
2. Obtain an owner/legal determination for the generated Worker containing
   GPL-3.0-or-later eSpeak code/data. The decision must state whether the project
   will comply with GPL source/licensing obligations for the combined work, or
   whether a differently licensed, technically revalidated phonemizer/G2P is
   required.
3. Obtain written owner/legal acceptance of the NeuroBERT ONNX conversion's
   missing explicit repository license statement, or obtain a conversion
   artifact whose license/provenance is explicit and repeat its Phase 0 asset
   hash/runtime checks.

No production integration or deployment should proceed until steps 1–3 are
resolved. Replacing the phonemizer/G2P would be an architecture and dependency
change, not a silent package substitution, and would require owner approval plus
a repeat of the TTS browser, quality, size, memory, Worker, offline, locality,
and build evidence.

## Primary evidence links

- Tesseract.js: <https://github.com/naptha/tesseract.js>
- Tesseract.js core: <https://github.com/naptha/tesseract.js-core>
- Project Naptha trained data: <https://github.com/naptha/tessdata>
- NeuroBERT ONNX conversion: <https://huggingface.co/onnx-community/NeuroBERT-NER-ONNX/tree/e3a6a290e438a506d2ba7bbb0f5875b7f034cebf>
- NeuroBERT source model: <https://huggingface.co/boltuix/NeuroBERT-NER>
- Transformers.js: <https://github.com/huggingface/transformers.js>
- ONNX Runtime: <https://github.com/microsoft/onnxruntime>
- Kitten model: <https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/tree/84781d74e29ee25217551556398b42f80593a813>
- Kitten browser wrapper: <https://github.com/svenflow/kitten-tts-webgpu>
- Phonemizer wrapper: <https://github.com/xenova/phonemizer.js>
- eSpeak NG license statement: <https://github.com/espeak-ng/espeak-ng#license-information>
- GNU GPL v3: <https://www.gnu.org/licenses/gpl-3.0.html>
