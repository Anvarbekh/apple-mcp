# 🍎 Apple MCP — Notes & Reminders

MCP server for Claude that integrates with Apple Notes and Reminders via AppleScript.

## Tools

- **notes** — search, list, create notes in Apple Notes
- **reminders** — list, search, create, open reminders in Apple Reminders

## Setup

```bash
bun install
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/apple-mcp/index.ts"]
    }
  }
}
```

Restart Claude Desktop — done.

## Permissions

macOS will prompt you to allow Automation access to **Notes** and **Reminders** on first use. Grant both.
