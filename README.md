# 🍎 Apple MCP — Notes & Reminders

MCP server for Claude that integrates with Apple Notes and Reminders via AppleScript.

## Tools

- **notes** — search, list, create notes in Apple Notes
- **reminders** — list, search, create, update, open reminders in Apple Reminders
  - Supports **image attachments** via macOS Shortcuts (see below)

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

## 🖼️ Image Attachments for Reminders

Apple's AppleScript API does not support attaching images to reminders. To work around this, the MCP uses a **macOS Shortcut** as a bridge.

### Setting up the Shortcut (one-time)

1. Open the **Shortcuts** app on your Mac
2. Click **+** to create a new shortcut
3. Name it exactly: **`Add Image Reminder`**
4. Configure it to receive **Images** as input
5. Add the following actions in order:

   | # | Action | Configuration |
   |---|--------|---------------|
   | 1 | **Run Shell Script** | Shell: `/bin/zsh`, Input: pass to stdin. Script: `echo "$REMINDER_META"` — this outputs the JSON metadata |
   | 2 | **Get Text from Input** | Use the output from step 1 |
   | 3 | **Get Dictionary from Input** | Parse the JSON text |
   | 4 | **Add New Reminder** | Title: `Name` from dictionary, Notes: `notes` from dictionary, List: `listName` from dictionary, Image: **Shortcut Input** |

   > **Simplified alternative**: If the above is complex, create a shortcut with just:
   > 1. **Add New Reminder** — set the title from "Shortcut Input" name, and attach the image from input
   > The metadata (list name, notes, due date) won't be passed, but the image will attach.

6. Save the shortcut

### How it works

When you use the `createWithImage` operation:

1. The MCP validates the image file exists and is a supported format
2. If the **"Add Image Reminder"** shortcut is found → runs it with the image, creating a reminder with a native attachment
3. If the shortcut is **not found** → falls back to creating a regular reminder with the image path as a clickable `file://` link in the notes

### Supported image formats

`.jpg` `.jpeg` `.png` `.heic` `.heif` `.gif` `.webp` `.tiff` `.tif` `.bmp`

### Usage example

```json
{
  "operation": "createWithImage",
  "name": "Receipt from lunch",
  "imagePath": "/Users/you/Desktop/receipt.jpg",
  "listName": "Expenses",
  "notes": "Team lunch at Sushi Place"
}
```
