import { exec } from "child_process";
import { promisify } from "util";
import { access, constants } from "fs/promises";
import { extname } from "path";

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
	// Check file exists and is readable
	try {
		await access(imagePath, constants.R_OK);
	} catch {
		return { valid: false, error: `Image file not found or not readable: ${imagePath}` };
	}

	// Check extension
	const ext = extname(imagePath).toLowerCase();
	if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
		return {
			valid: false,
			error: `Unsupported image format "${ext}". Supported: ${[...SUPPORTED_IMAGE_EXTENSIONS].join(", ")}`,
		};
	}

	return { valid: true };
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
 * - Reminder metadata as JSON via stdin
 *
 * The Shortcut should be configured to:
 * 1. Receive "Images" input
 * 2. Read JSON from "Shortcut Input" or use a "Get text from input" action
 * 3. Create a reminder with the image attached
 */
export async function runImageReminderShortcut(
	options: ShortcutReminderOptions,
): Promise<ShortcutResult> {
	// Validate image first
	const validation = await validateImagePath(options.imagePath);
	if (!validation.valid) {
		return { success: false, message: validation.error! };
	}

	// Check if shortcut exists
	const exists = await checkShortcutExists(SHORTCUT_NAME);
	if (!exists) {
		return {
			success: false,
			message: `Shortcut "${SHORTCUT_NAME}" not found. Please create it in the Shortcuts app. See README for setup instructions.`,
		};
	}

	try {
		// Build the metadata JSON to pass via stdin
		const metadata = JSON.stringify({
			name: options.name,
			listName: options.listName || "Reminders",
			notes: options.notes || "",
			dueDate: options.dueDate || "",
		});

		// Escape the image path for shell
		const escapedPath = options.imagePath.replace(/'/g, "'\\''");

		// Run the shortcut:
		// - The image file is passed via -i (input)
		// - Metadata is echoed to a temp file that the shortcut can reference,
		//   but since shortcuts CLI only takes one input, we encode metadata
		//   in an environment variable that the shortcut's "Run Shell Script" action can read
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
	runImageReminderShortcut,
};
