<!-- SYNCED with CIRCUS.md through 'circus sync'. Edit CIRCUS.md or this file; run 'circus sync' to align CLAUDE.md and AGENTS.md. -->

# Supermax Agent Notes

## The supermax plugin

This repository is also the `supermax` plugin marketplace for Claude Code and Codex. The Claude side is the source: `.claude-plugin/marketplace.json`, `packages/supermax/.claude-plugin/plugin.json` and `packages/supermax/skills/`. The Codex marketplace and package under `.agents/plugins/` are generated from it; never edit them by hand.

A change under `packages/supermax` bumps the plugin version in the same commit: run `circus plugins versions --write .`, then `circus plugins build .`, and commit only when `circus plugins check .` passes. Claude Code and Codex install the plugin from this canonical checkout and each runs a snapshot keyed by that version, so after the commit refresh both with `claude plugin update supermax@supermax` and `codex plugin add supermax@supermax`. That refresh needs no separate approval; a push is not part of it.

The skill holds the contract and points at `README.md` and `docs/application-shell.md` for signatures. When a public method or option changes, update the README reference in the same commit, and the skill only when the contract or the choice between features changes.
