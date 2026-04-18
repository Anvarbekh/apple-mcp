import { exec } from "child_process";
import { promisify } from "util";
import { access, constants, unlink } from "fs/promises";
import { extname, join } from "path";
import { tmpdir } from "os";

const execAsync = promisify(exec);

// The name of the macOS Shortcut that must be created by the user
export const SHORTCUT_NAME = "Add Image Reminder";

// Supported image formats
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".heic",
	".heif",
	".gif",
	".webp",
	".tiff",
	".tif",
	".bmp",
]);

/**
 * Check if a macOS Shortcut exists by name
 */
export async function checkShortcutExists(name: string): Promise<boolean> {
	try {
		const { stdout } = await execAsync("shortcuts list");
		const shortcuts = stdout.split("\n").map((s) => s.trim());
		return shortcuts.includes(name);
	} catch (error) {
		console.error(
			`Error checking shortcuts: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Validate that the image file exists and is a supported format
 */
export async function validateImagePath(
	imagePath: string,
): Promise<{ valid: boolean; error?: string }> {
	try {
		await access(imagePath, constants.R_OK);
	} catch {
		return { valid: false, error: `Image file not found or not readable: ${imagePath}` };
	}

	const ext = extname(imagePath).toLowerCase();
	if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
		return {
			valid: false,
			error: `Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS].join(", ")}`,
		};
	}

	return { valid: true };
}

/**
 * Check if the macOS clipboard currently contains an image.
 */
export async function clipboardHasImage(): Promise<boolean> {
	try {
		const script = `
ObjC.import('AppKit');
var pb = $.NSPasteboard.generalPasteboard;
var canRead = pb.canReadObjectForClassesOptions([$.NSImage], null);
canRead ? "YES" : "NO";`;

		const { stdout } = await execAsync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`);
		return stdout.trim() === "YES";
	} catch {
		return false;
	}
}

/**
 * Save the current clipboard image to a temporary PNG file.
 * Returns the file path on success, or an error message on failure.
 */
export async function saveClipboardImage(): Promise<{ success: boolean; path?: string; error?: string }> {
	const outputPath = join(tmpdir(), `apple-mcp-clipboard-${Date.now()}.png`);

	const script = `
ObjC.import('AppKit');
ObjC.import('Foundation');

var pb = $.NSPasteboard.generalPasteboard;
var canRead = pb.canReadObjectForClassesOptions([$.NSImage], null);

if (!canRead) {
    "NO_IMAGE";
} else {
    var images = pb.readObjectsForClassesOptions([$.NSImage], null);
    var image = images.objectAtIndex(0);
    var tiffData = image.TIFFRepresentation;
    var bitmap = $.NSBitmapImageRep.imageRepWithData(tiffData);
    var pngData = bitmap.representationUsingTypeProperties($.NSPNGFileType, null);
    var ok = pngData.writeToFileAtomically("${outputPath}", true);
    ok ? "SUCCESS" : "WRITE_FAILED";
}`;

	try {
		const { stdout } = await execAsync(
			`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`,
			{ timeout: 15000 },
		);
		const result = stdout.trim();

		if (result === "SUCCESS") {
			return { success: true, path: outputPath };
		} else if (result === "NO_IMAGE") {
			return { success: false, error: "No image found on the clipboard. Copy an image first, then try again." };
		} else {
			return { success: false, error: "Failed to write clipboard image to disk." };
		}
	} catch (error) {
		return {
			success: false,
			error: `Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Clean up a temporary clipboard image file.
 */
export async function cleanupTempImage(filePath: string): Promise<void> {
	try {
		if (filePath.includes("apple-mcp-clipboard-")) {
			await unlink(filePath);
		}
	} catch {
		// Ignore cleanup errors
	}
}

export interface ShortcutReminderOptions {
	/** Name/title of the reminder */
	name: string;
	/** Absolute path to the image file */
	imagePath: string;
	/** Target reminder list name */
	listName?: string;
	/** Additional notes for the reminder */
	notes?: string;
	/** Due date in ISO format */
	dueDate?: string;
}

export interface ShortcutResult {
	success: boolean;
	message: string;
}

/**
 * Run the "Add Image Reminder" shortcut with an image and reminder metadata.
 *
 * The shortcut receives:
 * - The image file as input (via -i flag)
 * - Reminder metadata as JSON in REMINDER_META env var
 */
export async function runImageReminderShortcut(
	options: ShortcutReminderOptions,
): Promise<ShortcutResult> {
	const validation = await validateImagePath(options.imagePath);
	if (!validation.valid) {
		return { success: false, message: validation.error! };
	}

	const exists = await checkShortcutExists(SHORTCUT_NAME);
	if (!exists) {
		return {
			success: false,
			message: `Shortcut "${SHORTCUT_NAME}" not found. Please create it in the Shortcuts app. See README for setup instructions.`,
		};
	}

	try {
		const metadata = JSON.stringify({
			name: options.name,
			listName: options.listName || "Reminders",
			notes: options.notes || "",
			dueDate: options.dueDate || "",
		});

		const escapedPath = options.imagePath.replace(/'/g, "'\\''");

		const command = `REMINDER_META='${metadata.replace(/'/g, "'\\''")}' shortcuts run '${SHORTCUT_NAME.replace(/'/g, "'\\''")}' -i '${escapedPath}'`;

		await execAsync(command, { timeout: 30000 });

		return {
			success: true,
			message: `Created reminder "${options.name}" with image attachment.`,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			message: `Failed to run shortcut: ${msg}`,
		};
	}
}

export default {
	SHORTCUT_NAME,
	checkShortcutExists,
	validateImagePath,
	clipboardHasImage,
	saveClipboardImage,
	cleanupTempImage,
	runImageReminderShortcut,
};
