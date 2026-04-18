import { type Tool } from "@modelcontextprotocol/sdk/types.js";

const NOTES_TOOL: Tool = {
	name: "notes",
	description: "Search, retrieve and create notes in Apple Notes app",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				description: "Operation to perform: 'search', 'list', or 'create'",
				enum: ["search", "list", "create"],
			},
			searchText: {
				type: "string",
				description:
					"Text to search for in notes (required for search operation)",
			},
			title: {
				type: "string",
				description:
					"Title of the note to create (required for create operation)",
			},
			body: {
				type: "string",
				description:
					"Content of the note to create (required for create operation)",
			},
			folderName: {
				type: "string",
				description:
					"Name of the folder to create the note in (optional for create operation, defaults to 'Claude')",
			},
		},
		required: ["operation"],
	},
};

const REMINDERS_TOOL: Tool = {
	name: "reminders",
	description: "Search, create (with optional image from clipboard or file), update, and open reminders in Apple Reminders app",
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				description:
					"Operation to perform: 'list', 'search', 'open', 'create', 'createWithImage', 'update', or 'listById'",
				enum: ["list", "search", "open", "create", "createWithImage", "update", "listById"],
			},
			searchText: {
				type: "string",
				description:
					"Text to search for in reminders (required for search, open, and update operations)",
			},
			name: {
				type: "string",
				description:
					"Name of the reminder to create (required for create operation)",
			},
			listName: {
				type: "string",
				description:
					"Name of the list to target (optional for create and update operations)",
			},
			listId: {
				type: "string",
				description:
					"ID of the list to get reminders from (required for listById operation)",
			},
			props: {
				type: "array",
				items: { type: "string" },
				description:
					"Properties to include in the reminders (optional for listById operation)",
			},
			notes: {
				type: "string",
				description:
					"Additional notes for the reminder (optional for create operation)",
			},
			dueDate: {
				type: "string",
				description:
					"Due date for the reminder in ISO format (optional for create and update operations)",
			},
			newName: {
				type: "string",
				description:
					"New name/title for the reminder (optional for update operation)",
			},
			newBody: {
				type: "string",
				description:
					"New body/notes for the reminder (optional for update operation)",
			},
			priority: {
				type: "number",
				description:
					"Priority level: 0 = none, 1 = high, 5 = medium, 9 = low (optional for update operation)",
				enum: [0, 1, 5, 9],
			},
			completed: {
				type: "boolean",
				description:
					"Mark the reminder as completed (true) or incomplete (false) (optional for update operation)",
			},
			imagePath: {
				type: "string",
				description:
					"Absolute path to an image file (optional for createWithImage). If omitted, the image is grabbed from the macOS clipboard automatically. Supported formats: jpg, png, heic, gif, webp, tiff, bmp",
			},
		},
		required: ["operation"],
	},
};

const tools = [NOTES_TOOL, REMINDERS_TOOL];

export default tools;
