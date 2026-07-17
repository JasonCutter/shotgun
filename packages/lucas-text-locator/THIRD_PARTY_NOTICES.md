# Third-party notice

This package adapts the highlight-locator algorithm and tests from:

- Project: `lucasastorian/llmwiki`
- Source: https://github.com/lucasastorian/llmwiki
- Commit: `ad626a3d81be1480e35ef4e94234de8dbb27a61e`
- Upstream files: `api/html_parser/parser.py`, `tests/unit/test_html_parser_highlights.py`
- License: Apache-2.0

Shotgun changes the implementation language from Python to TypeScript, returns a small neutral
`{ start, end }` contract, uses Unicode code-point offsets, and rejects unresolved duplicate quotes
instead of guessing. SQLite, VaultFS, HTML parsing, MCP CRUD, and filesystem watching are excluded.
