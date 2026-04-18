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

You can attach images to reminders by **copying an image to your clipboard**, then asking Claude to create a reminder with it.

### Quick usage

1. **Copy** any image (⌘C from Preview, Finder, browser, screenshot, etc.)
2. Tell Claude: *"Create a reminder called 'Save this receipt' with the image I just copied"*
3. The MCP grabs the image from your clipboard and attaches it

You can also provide a file path directly:
> *"Create a reminder with the image at `/Users/me/Desktop/photo.jpg`"*

### How it works under the hood

```
Copy image → Claude calls createWithImage → MCP reads clipboard → Shortcut attaches it
```

1. If no `imagePath` is given, the MCP extracts the image from the macOS **clipboard** (pasteboard) via JXA/NSPasteboard
2. If the **"Add Image Reminder"** Shortcut is installed → creates a reminder with a **native image attachment**
3. If the Shortcut is **not installed** → falls back to creating a reminder with a clickable `file://` link in the notes

### Setting up the Shortcut (one-time, for native attachments)

Without this Shortcut, images are saved as links in notes. With it, they become real attachments.

1. Open the **Shortcuts** app on your Mac
2. Click **+** to create a new shortcut
3. Name it exactly: **`Add Image Reminder`**
4. Configure it to receive **Images** as input
5. Add these actions:

   | # | Action | Configuration |
   |---|--------|---------------|
   | 1 | **Run Shell Script** | Shell: `/bin/zsh`, Script: `echo "$REMINDER_META"` |
   | 2 | **Get Dictionary from Input** | From the shell script output |
   | 3 | **Add New Reminder** | Title: `Name` from dictionary, Notes: `notes` from dictionary, List: `listName` from dictionary, Image: **Shortcut Input** |

6. Save the shortcut

### Supported image formats

`.jpg` `.jpeg` `.png` `.heic` `.heif` `.gif` `.webp` `.tiff` `.tif` `.bmp`
