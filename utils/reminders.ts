import { runAppleScript } from "run-applescript";
import {
	runImageReminderShortcut,
	validateImagePath,
	checkShortcutExists,
	clipboardHasImage,
	saveClipboardImage,
	cleanupTempImage,
	SHORTCUT_NAME,
} from "./shortcuts";

// Configuration
const CONFIG = {
	// Maximum reminders to process (to avoid performance issues)
	MAX_REMINDERS: 100,
	// Maximum lists to process
	MAX_LISTS: 20,
	// Timeout for operations
	TIMEOUT_MS: 30000,
};

// Delimiter used to separate fields in AppleScript output
const FIELD_DELIM = "|||";
const RECORD_DELIM = "<<<>>>";

// Define types for our reminders
interface ReminderList {
	name: string;
	id: string;
}

interface Reminder {
	name: string;
	id: string;
	body: string;
	completed: boolean;
	dueDate: string | null;
	listName: string;
	completionDate?: string | null;
	creationDate?: string | null;
	modificationDate?: string | null;
	remindMeDate?: string | null;
	priority?: number;
}

/**
 * Parse delimited AppleScript output into Reminder objects
 */
function parseRemindersOutput(output: string): Reminder[] {
	if (!output || output.trim() === "" || output === "EMPTY") return [];

	const records = output.split(RECORD_DELIM).filter((r) => r.trim() !== "");
	return records.map((record) => {
		const fields = record.split(FIELD_DELIM);
		return {
			name: fields[0] || "",
			id: fields[1] || "",
			body: fields[2] || "",
			completed: fields[3] === "true",
			dueDate: fields[4] && fields[4] !== "missing value" ? fields[4] : null,
			listName: fields[5] || "",
			priority: fields[6] ? parseInt(fields[6], 10) : 0,
			creationDate: fields[7] && fields[7] !== "missing value" ? fields[7] : null,
			modificationDate: fields[8] && fields[8] !== "missing value" ? fields[8] : null,
			completionDate: fields[9] && fields[9] !== "missing value" ? fields[9] : null,
			remindMeDate: fields[10] && fields[10] !== "missing value" ? fields[10] : null,
		};
	});
}

/**
 * Check if Reminders app is accessible
 */
async function checkRemindersAccess(): Promise<boolean> {
	try {
		const script = `
tell application "Reminders"
    return name
end tell`;

		await runAppleScript(script);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Reminders app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Reminders app access and provide instructions if not available
 */
async function requestRemindersAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkRemindersAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Reminders access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Reminders access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Reminders\n2. Enable access for your terminal app (or Claude Desktop / node)\n3. Restart the MCP server and try again"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Reminders access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

/**
 * Get all reminder lists (limited for performance)
 * @returns Array of reminder lists with their names and IDs
 */
async function getAllLists(): Promise<ReminderList[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Reminders"
    set output to ""
    set allLists to lists

    repeat with i from 1 to (count of allLists)
        if i > ${CONFIG.MAX_LISTS} then exit repeat
        try
            set currentList to item i of allLists
            set listName to name of currentList
            set listId to id of currentList

            if i > 1 then set output to output & "${RECORD_DELIM}"
            set output to output & listName & "${FIELD_DELIM}" & listId
        on error
            -- Skip problematic lists
        end try
    end repeat

    if output is "" then return "EMPTY"
    return output
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (!result || result === "EMPTY") return [];

		const records = result.split(RECORD_DELIM).filter((r) => r.trim() !== "");
		return records.map((record) => {
			const parts = record.split(FIELD_DELIM);
			return {
				name: parts[0] || "Untitled List",
				id: parts[1] || "unknown-id",
			};
		});
	} catch (error) {
		console.error(
			`Error getting reminder lists: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Helper to build the AppleScript snippet that serialises a single reminder
 */
function reminderSerialiserSnippet(reminderVar: string, listNameExpr: string): string {
	return `
        set rName to name of ${reminderVar}
        set rId to id of ${reminderVar}
        try
            set rBody to body of ${reminderVar}
            if rBody is missing value then set rBody to ""
        on error
            set rBody to ""
        end try
        set rCompleted to completed of ${reminderVar}
        try
            set rDue to due date of ${reminderVar} as string
        on error
            set rDue to "missing value"
        end try
        set rPriority to priority of ${reminderVar}
        try
            set rCreation to creation date of ${reminderVar} as string
        on error
            set rCreation to "missing value"
        end try
        try
            set rMod to modification date of ${reminderVar} as string
        on error
            set rMod to "missing value"
        end try
        try
            set rComp to completion date of ${reminderVar} as string
        on error
            set rComp to "missing value"
        end try
        try
            set rRemind to remind me date of ${reminderVar} as string
        on error
            set rRemind to "missing value"
        end try

        if rCompleted then
            set compStr to "true"
        else
            set compStr to "false"
        end if

        set entry to rName & "${FIELD_DELIM}" & rId & "${FIELD_DELIM}" & rBody & "${FIELD_DELIM}" & compStr & "${FIELD_DELIM}" & rDue & "${FIELD_DELIM}" & ${listNameExpr} & "${FIELD_DELIM}" & (rPriority as string) & "${FIELD_DELIM}" & rCreation & "${FIELD_DELIM}" & rMod & "${FIELD_DELIM}" & rComp & "${FIELD_DELIM}" & rRemind`;
}

/**
 * Get all incomplete reminders across all lists
 * @param listName Optional list name to filter by
 * @returns Array of reminders
 */
async function getAllReminders(listName?: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		let filterClause: string;
		if (listName) {
			const clean = listName.replace(/"/g, '\\"');
			filterClause = `set targetLists to {list "${clean}"}`;
		} else {
			filterClause = `set targetLists to lists`;
		}

		const script = `
tell application "Reminders"
    set output to ""
    set totalCount to 0
    ${filterClause}

    repeat with currentList in targetLists
        set lName to name of currentList
        set theReminders to (reminders of currentList whose completed is false)

        repeat with r in theReminders
            if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
            try
                ${reminderSerialiserSnippet("r", "lName")}
                if totalCount > 0 then set output to output & "${RECORD_DELIM}"
                set output to output & entry
                set totalCount to totalCount + 1
            on error
                -- skip problematic reminder
            end try
        end repeat
        if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
    end repeat

    if output is "" then return "EMPTY"
    return output
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseRemindersOutput(result);
	} catch (error) {
		console.error(
			`Error getting reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Search for reminders by text across all lists
 * @param searchText Text to search for in reminder names or notes
 * @returns Array of matching reminders
 */
async function searchReminders(searchText: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!searchText || searchText.trim() === "") {
			return [];
		}

		const cleanSearch = searchText.replace(/"/g, '\\"').toLowerCase();

		const script = `
tell application "Reminders"
    set output to ""
    set totalCount to 0
    set searchTerm to "${cleanSearch}"

    repeat with currentList in lists
        set lName to name of currentList
        set theReminders to reminders of currentList

        repeat with r in theReminders
            if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
            try
                set rName to name of r
                try
                    set rBody to body of r
                    if rBody is missing value then set rBody to ""
                on error
                    set rBody to ""
                end try

                -- Case-insensitive search: compare lowercased strings
                set lowerName to do shell script "echo " & quoted form of rName & " | tr '[:upper:]' '[:lower:]'"
                set lowerBody to do shell script "echo " & quoted form of rBody & " | tr '[:upper:]' '[:lower:]'"

                if lowerName contains searchTerm or lowerBody contains searchTerm then
                    ${reminderSerialiserSnippet("r", "lName")}
                    if totalCount > 0 then set output to output & "${RECORD_DELIM}"
                    set output to output & entry
                    set totalCount to totalCount + 1
                end if
            on error
                -- skip problematic reminder
            end try
        end repeat
        if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
    end repeat

    if output is "" then return "EMPTY"
    return output
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseRemindersOutput(result);
	} catch (error) {
		console.error(
			`Error searching reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Create a new reminder
 * @param name Name of the reminder
 * @param listName Name of the list to add the reminder to (creates if doesn't exist)
 * @param notes Optional notes for the reminder
 * @param dueDate Optional due date for the reminder (ISO string)
 * @returns The created reminder
 */
async function createReminder(
	name: string,
	listName: string = "Reminders",
	notes?: string,
	dueDate?: string,
): Promise<Reminder> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Validate inputs
		if (!name || name.trim() === "") {
			throw new Error("Reminder name cannot be empty");
		}

		const cleanName = name.replace(/"/g, '\\"');
		const cleanListName = listName.replace(/"/g, '\\"');
		const cleanNotes = notes ? notes.replace(/"/g, '\\"') : "";

		// Build properties for AppleScript
		let propsStr = `{name:"${cleanName}"`;
		if (cleanNotes) {
			propsStr += `, body:"${cleanNotes}"`;
		}
		propsStr += `}`;

		// Build due date setter (locale-independent approach)
		let dueDateScript = "";
		if (dueDate) {
			const d = new Date(dueDate);
			dueDateScript = `
            set dueD to current date
            set month of dueD to ${d.getMonth() + 1}
            set day of dueD to ${d.getDate()}
            set year of dueD to ${d.getFullYear()}
            set hours of dueD to ${d.getHours()}
            set minutes of dueD to ${d.getMinutes()}
            set seconds of dueD to 0
            set due date of newReminder to dueD
            set remind me date of newReminder to dueD`;
		}

		const script = `
tell application "Reminders"
    try
        -- Find or use target list
        set targetList to missing value
        try
            set targetList to list "${cleanListName}"
        end try
        if targetList is missing value then
            set allLists to lists
            if (count of allLists) > 0 then
                set targetList to first item of allLists
            else
                return "ERROR:No lists available"
            end if
        end if
        set listName to name of targetList

        -- Create reminder with properties
        set newReminder to make new reminder at targetList with properties ${propsStr}
        ${dueDateScript}
        return "SUCCESS:" & listName
    on error errorMessage
        return "ERROR:" & errorMessage
    end try
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result && result.startsWith("SUCCESS:")) {
			const actualListName = result.replace("SUCCESS:", "");

			return {
				name: name,
				id: "created-reminder-id",
				body: notes || "",
				completed: false,
				dueDate: dueDate || null,
				listName: actualListName,
			};
		} else {
			throw new Error(`Failed to create reminder: ${result}`);
		}
	} catch (error) {
		throw new Error(
			`Failed to create reminder: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

interface OpenReminderResult {
	success: boolean;
	message: string;
	reminder?: Reminder;
}

/**
 * Open the Reminders app and show a specific reminder
 * @param searchText Text to search for in reminder names or notes
 * @returns Result of the operation
 */
async function openReminder(searchText: string): Promise<OpenReminderResult> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		// First search for the reminder
		const matchingReminders = await searchReminders(searchText);

		if (matchingReminders.length === 0) {
			return { success: false, message: `No reminders found matching "${searchText}"` };
		}

		// Open the Reminders app
		const script = `
tell application "Reminders"
    activate
    return "SUCCESS"
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result === "SUCCESS") {
			return {
				success: true,
				message: "Reminders app opened",
				reminder: matchingReminders[0],
			};
		} else {
			return { success: false, message: "Failed to open Reminders app" };
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to open reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get reminders from a specific list by ID
 * @param listId ID of the list to get reminders from
 * @param props Array of properties to include (optional)
 * @returns Array of reminders with basic properties
 */
async function getRemindersFromListById(
	listId: string,
	props?: string[],
): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const cleanId = listId.replace(/"/g, '\\"');

		const script = `
tell application "Reminders"
    set output to ""
    set totalCount to 0

    -- Find list by ID
    set targetList to missing value
    repeat with currentList in lists
        if id of currentList is "${cleanId}" then
            set targetList to currentList
            exit repeat
        end if
    end repeat

    if targetList is missing value then return "EMPTY"

    set lName to name of targetList
    set theReminders to (reminders of targetList whose completed is false)

    repeat with r in theReminders
        if totalCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
        try
            ${reminderSerialiserSnippet("r", "lName")}
            if totalCount > 0 then set output to output & "${RECORD_DELIM}"
            set output to output & entry
            set totalCount to totalCount + 1
        on error
            -- skip problematic reminder
        end try
    end repeat

    if output is "" then return "EMPTY"
    return output
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseRemindersOutput(result);
	} catch (error) {
		console.error(
			`Error getting reminders from list by ID: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

interface UpdateReminderOptions {
	/** Find reminder by exact name */
	searchText: string;
	/** Optional: restrict search to a specific list */
	listName?: string;
	/** New name for the reminder */
	newName?: string;
	/** New body/notes */
	newBody?: string;
	/** Priority: 0 = none, 1 = high, 5 = medium, 9 = low */
	priority?: number;
	/** New due date (ISO string) */
	dueDate?: string;
	/** Mark as completed or incomplete */
	completed?: boolean;
}

interface UpdateReminderResult {
	success: boolean;
	message: string;
	updated?: Partial<Reminder>;
}

/**
 * Update an existing reminder's properties
 * Finds the first reminder matching searchText (by name), then applies updates.
 */
async function updateReminder(options: UpdateReminderOptions): Promise<UpdateReminderResult> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!options.searchText || options.searchText.trim() === "") {
			throw new Error("searchText is required to find the reminder to update");
		}

		const cleanSearch = options.searchText.replace(/"/g, '\\"');

		// Build the list filter
		let listFilter: string;
		if (options.listName) {
			const cleanList = options.listName.replace(/"/g, '\\"');
			listFilter = `set targetLists to {list "${cleanList}"}`;
		} else {
			listFilter = `set targetLists to lists`;
		}

		// Build the property-setting lines
		const setLines: string[] = [];
		if (options.newName !== undefined) {
			const clean = options.newName.replace(/"/g, '\\"');
			setLines.push(`set name of targetReminder to "${clean}"`);
		}
		if (options.newBody !== undefined) {
			const clean = options.newBody.replace(/"/g, '\\"');
			setLines.push(`set body of targetReminder to "${clean}"`);
		}
		if (options.priority !== undefined) {
			const p = Math.max(0, Math.min(9, Math.round(options.priority)));
			setLines.push(`set priority of targetReminder to ${p}`);
		}
		if (options.completed !== undefined) {
			setLines.push(`set completed of targetReminder to ${options.completed}`);
		}
		if (options.dueDate !== undefined) {
			const d = new Date(options.dueDate);
			setLines.push(`
            set dueD to current date
            set month of dueD to ${d.getMonth() + 1}
            set day of dueD to ${d.getDate()}
            set year of dueD to ${d.getFullYear()}
            set hours of dueD to ${d.getHours()}
            set minutes of dueD to ${d.getMinutes()}
            set seconds of dueD to 0
            set due date of targetReminder to dueD
            set remind me date of targetReminder to dueD`);
		}

		if (setLines.length === 0) {
			return { success: false, message: "No properties to update were provided." };
		}

		const setBlock = setLines.join("\n            ");

		const script = `
tell application "Reminders"
    ${listFilter}
    set targetReminder to missing value
    set foundInList to ""

    repeat with currentList in targetLists
        set theReminders to reminders of currentList
        repeat with r in theReminders
            if name of r is "${cleanSearch}" then
                set targetReminder to r
                set foundInList to name of currentList
                exit repeat
            end if
        end repeat
        if targetReminder is not missing value then exit repeat
    end repeat

    if targetReminder is missing value then
        return "ERROR:No reminder found matching \\"${cleanSearch}\\""
    end if

    try
        ${setBlock}
        return "SUCCESS:" & foundInList & "|||" & name of targetReminder
    on error errorMessage
        return "ERROR:" & errorMessage
    end try
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result && result.startsWith("SUCCESS:")) {
			const parts = result.replace("SUCCESS:", "").split(FIELD_DELIM);
			return {
				success: true,
				message: `Updated reminder "${parts[1] || options.searchText}" in list "${parts[0]}".`,
				updated: {
					name: options.newName || options.searchText,
					listName: parts[0],
					...(options.priority !== undefined && { priority: options.priority }),
					...(options.completed !== undefined && { completed: options.completed }),
					...(options.dueDate !== undefined && { dueDate: options.dueDate }),
					...(options.newBody !== undefined && { body: options.newBody }),
				},
			};
		} else {
			const errMsg = result ? result.replace("ERROR:", "") : "Unknown error";
			return { success: false, message: errMsg };
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to update reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Create a reminder with an image attachment.
 *
 * Image source (in priority order):
 * 1. If `imagePath` is provided → use that file
 * 2. Otherwise → grab the image from the macOS clipboard
 *
 * Attachment method:
 * 1. If the "Add Image Reminder" Shortcut is installed → native attachment
 * 2. Otherwise → fallback with file:// link in notes
 *
 * @param name Name of the reminder
 * @param imagePath Optional absolute path to an image file (defaults to clipboard)
 * @param listName Target reminder list (default: "Reminders")
 * @param notes Optional additional notes
 * @param dueDate Optional due date (ISO string)
 */
async function createReminderWithImage(
	name: string,
	imagePath?: string,
	listName?: string,
	notes?: string,
	dueDate?: string,
): Promise<{
	success: boolean;
	message: string;
	usedFallback: boolean;
	imageSource: "file" | "clipboard";
	reminder?: Reminder;
}> {
	let resolvedImagePath: string;
	let isTemp = false;
	const imageSource: "file" | "clipboard" = imagePath ? "file" : "clipboard";

	// ── Resolve the image ──────────────────────────────────────
	if (imagePath) {
		// User provided a file path
		const validation = await validateImagePath(imagePath);
		if (!validation.valid) {
			return { success: false, message: validation.error!, usedFallback: false, imageSource };
		}
		resolvedImagePath = imagePath;
	} else {
		// Grab from clipboard
		const hasImage = await clipboardHasImage();
		if (!hasImage) {
			return {
				success: false,
				message: "No image found on the clipboard. Copy an image first, then try again.",
				usedFallback: false,
				imageSource,
			};
		}

		const clipResult = await saveClipboardImage();
		if (!clipResult.success || !clipResult.path) {
			return {
				success: false,
				message: clipResult.error || "Failed to save clipboard image.",
				usedFallback: false,
				imageSource,
			};
		}

		resolvedImagePath = clipResult.path;
		isTemp = true;
	}

	// ── Try Shortcuts approach ─────────────────────────────────
	const shortcutExists = await checkShortcutExists(SHORTCUT_NAME);

	if (shortcutExists) {
		const result = await runImageReminderShortcut({
			name,
			imagePath: resolvedImagePath,
			listName,
			notes,
			dueDate,
		});

		if (result.success) {
			if (isTemp) await cleanupTempImage(resolvedImagePath);
			return {
				success: true,
				message: result.message,
				usedFallback: false,
				imageSource,
				reminder: {
					name,
					id: "created-via-shortcut",
					body: notes || "",
					completed: false,
					dueDate: dueDate || null,
					listName: listName || "Reminders",
				},
			};
		}

		console.error(`Shortcut failed, using fallback: ${result.message}`);
	}

	// ── Fallback: embed file:// link in notes ──────────────────
	const fallbackNotes = notes
		? `${notes}\n\n📎 Image: file://${resolvedImagePath}`
		: `📎 Image: file://${resolvedImagePath}`;

	try {
		const reminder = await createReminder(name, listName, fallbackNotes, dueDate);

		// Don't clean up temp file when using fallback — the link needs the file to exist
		return {
			success: true,
			message: shortcutExists
				? `Created reminder "${name}" with image path in notes (shortcut failed, used fallback).`
				: `Created reminder "${name}" with image path in notes. To enable native image attachments, create the "${SHORTCUT_NAME}" shortcut in the Shortcuts app.`,
			usedFallback: true,
			imageSource,
			reminder,
		};
	} catch (error) {
		if (isTemp) await cleanupTempImage(resolvedImagePath);
		return {
			success: false,
			message: `Failed to create reminder: ${error instanceof Error ? error.message : String(error)}`,
			usedFallback: true,
			imageSource,
		};
	}
}

export default {
	getAllLists,
	getAllReminders,
	searchReminders,
	createReminder,
	createReminderWithImage,
	openReminder,
	getRemindersFromListById,
	updateReminder,
	requestRemindersAccess,
};
