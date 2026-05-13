---
name: windy
description: "Use when the user asks about Windy — query data, manage resources, or interact with the Windy platform. Provides CLI commands for all Windy API operations."
---

# Windy CLI Skill

Queries and manages Windy data via the `windy` CLI.

## Setup

Credentials stored in psst `windy` env profile:

```bash
psst --global run --env windy 'windy <command>'
```

## Commands

### auth
Verify authentication and show user info.
```
windy auth
```

> TODO: Add commands here as you implement them during Phase 7.

## Output Formats
- `--format toon` (default) — human-readable
- `--format json` — machine-readable JSON
