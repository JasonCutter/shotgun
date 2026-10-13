# Fresh isolated document runtime verification

2026-10-13. Result: **FRESH_PYTHON_FORMAT_SCOPE_PASS**, not operating desktop or semantic acceptance.

The application distribution proof initially established only a fresh JavaScript installation. This follow-up created a new owned Python virtual environment under `C:/dev/artifacts/vp-full-completion-2026-10-12/fresh-document-python-20261013`, using the existing host Python3.14 executable solely as a venv seed. It did not change global Python, PATH, operating environment, provider settings or production data.

The captured distribution's existing `requirements.lock` was installed into that new venv from the explicit public PyPI index, with configuration loading disabled, no cache, version-check disabled and wheels only. All17 pinned dependency names/versions were checked against the pip report; unexpected transitive packages would fail. No new dependency or version was adopted. The pip report records resolved wheel URLs/digests; this proof does not replace the existing license/security/OSS register or claim a freshly installed standalone Python interpreter.

Requirements SHA-256: `39c745079b56f4abce5aec45e7af8b3fcbfc63481af617e6802a0372b7f83a07`.
Captured worker SHA-256: `db94743f1dab6b45e08e117eb800bb4c0718bcab95d64d9aa4a94ed3fcb867fa`.
The captured and current unchanged worker bytes were compared before execution.

The existing canonical-compatible `PythonDocumentFormatAdapter` was given that captured worker and fresh venv explicitly. This did not use the retained distribution's workspace junctions or claim its Node runtime was independently installed. The six existing authored structural format fixtures were read without modification:

| Format | Checked locator                 | Result |
| ------ | ------------------------------- | ------ |
| HTML   | CSS                             | PASS   |
| PDF    | Page                            | PASS   |
| DOCX   | Cell                            | PASS   |
| CSV    | Cell                            | PASS   |
| XLSX   | Cell, exact `=1+1` formula text | PASS   |
| PPTX   | Shape                           | PASS   |

For every case, its known structural marker was present, original bytes stayed identical and every SourceMap entry retained the exact SourceVersion/content-hash pin. These six cases verify the new runtime/dependency boundary; they are not independent semantic Gold, complete document recall, multimodal meaning or actual installed-app browser intake.

Reproduction and evidence are retained outside the repository:

- `fresh-python-converter-proof.cjs` — sanitized owned venv/dependency installation, exact version checks.
- `fresh-python-dependency-proof.json`, `fresh-python-install-report.json` and `fresh-python-install.log`.
- `fresh-python-format-proof.mts` — adapter/worker/fixture integrity and locator assertions.
- `fresh-python-format-proof.json`, `fresh-python-format-proof-final.log`.
- Initial Windows absolute ESM URL invocation failure remains `fresh-python-format-proof.log`; the harness then used `pathToFileURL`, with no product implementation change.

This narrows the earlier fresh-Python provisioning residual to standalone interpreter packaging, native deployed path/configuration and actual installed Canonical acceptance. All model/provider calls remain0. Existing exact pins and Python adapter/worker are reused; rollback removes only the owned verification environment and artifacts after retention is no longer needed.
