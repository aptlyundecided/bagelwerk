# OpenRouter Search Extension

Project-local pi extension that adds a basic `web_search` tool.

## What it does

- auto-loads from `.pi/extensions/`
- reads `OPENROUTER_API_KEY` from the repo-root `.env`
- calls OpenRouter chat completions
- defaults to `perplexity/sonar-pro`
- returns an answer plus any surfaced source URLs

## Usage

1. Start or reload pi in this repo.
2. Ask for live web research.
3. The agent can call `web_search` when current internet context is needed.

Example prompts:
- `Search the web for the current best practices around agent handoff loops.`
- `Look up Perplexity Sonar Pro docs and summarize the relevant API behavior.`

## Environment

Expected env var in repo-root `.env`:

- `OPENROUTER_API_KEY`

Optional overrides:

- `OPENROUTER_SEARCH_MODEL` — defaults to `perplexity/sonar-pro`
- `OPENROUTER_BASE_URL` — defaults to `https://openrouter.ai/api/v1`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_SITE_NAME`

## Notes

This is intentionally minimal. It is a single-tool extension, not a full browsing stack.
