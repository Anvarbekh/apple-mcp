#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import tools from "./tools";

console.error("Starting apple-mcp server...");

// Lazy-loaded modules
let notes: typeof import("./utils/notes").default | null = null;
let reminders: typeof import("./utils/reminders").default | null = null;

async function loadNotes() {
	if (!notes) notes = (await import("./utils/notes")).default;
	return notes;
}

async function loadReminders() {
	if (!reminders) reminders = (await import("./utils/reminders")).default;
	return reminders;
}

// --- Server setup ---

const server = new Server(
	{
		name: "Apple MCP tools",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	try {
		const { name, arguments: args } = request.params;

		if (!args) {
			throw new Error("No arguments provided");
		}

		switch (name) {
			// ── Notes ───────────────────────────────────────
			case "notes": {
				if (!isNotesArgs(args)) {
					throw new Error("Invalid arguments for notes tool");
				}

				try {
					const notesModule = await loadNotes();
					const { operation } = args;

					switch (operation) {
						case "search": {
							if (!args.searchText) {
								throw new Error("Search text is required for search operation");
							}

							const foundNotes = await notesModule.findNote(args.searchText);
							return {
								content: [
									{
										type: "text",
										text: foundNotes.length
											? foundNotes
													.map((note) => `${note.name}:\n${note.content}`)
													.join("\n\n")
											: `No notes found for "${args.searchText}"`,
									},
								],
								isError: false,
							};
						}

						case "list": {
							const allNotes = await notesModule.getAllNotes();
							return {
								content: [
									{
										type: "text",
										text: allNotes.length
											? allNotes
													.map((note) => `${note.name}:\n${note.content}`)
													.join("\n\n")
											: "No notes exist.",
									},
								],
								isError: false,
							};
						}

						case "create": {
							if (!args.title || !args.body) {
								throw new Error(
									"Title and body are required for create operation",
								);
							}

							const result = await notesModule.createNote(
								args.title,
								args.body,
								args.folderName,
							);

							return {
								content: [
									{
										type: "text",
										text: result.success
											? `Created note "${args.title}" in folder "${result.folderName}"${result.usedDefaultFolder ? " (created new folder)" : ""}.`
											: `Failed to create note: ${result.message}`,
									},
								],
								isError: !result.success,
							};
						}

						default:
							throw new Error(`Unknown operation: ${operation}`);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						content: [
							{
								type: "text",
								text: errorMessage.includes("access")
									? errorMessage
									: `Error accessing notes: ${errorMessage}`,
							},
						],
						isError: true,
					};
				}
			}

			// ── Reminders ───────────────────────────────────
			case "reminders": {
				if (!isRemindersArgs(args)) {
					throw new Error("Invalid arguments for reminders tool");
				}

				try {
					const remindersModule = await loadReminders();
					const { operation } = args;

					if (operation === "list") {
						const lists = await remindersModule.getAllLists();
						const allReminders = await remindersModule.getAllReminders();
						return {
							content: [
								{
									type: "text",
									text: `Found ${lists.length} lists and ${allReminders.length} reminders.`,
								},
							],
							lists,
							reminders: allReminders,
							isError: false,
						};
					} else if (operation === "search") {
						const { searchText } = args;
						const results = await remindersModule.searchReminders(searchText!);
						return {
							content: [
								{
									type: "text",
									text:
										results.length > 0
											? `Found ${results.length} reminders matching "${searchText}".`
											: `No reminders found matching "${searchText}".`,
								},
							],
							reminders: results,
							isError: false,
						};
					} else if (operation === "open") {
						const { searchText } = args;
						const result = await remindersModule.openReminder(searchText!);
						return {
							content: [
								{
									type: "text",
									text: result.success
										? `Opened Reminders app. Found reminder: ${result.reminder?.name}`
										: result.message,
								},
							],
							...result,
							isError: !result.success,
						};
					} else if (operation === "create") {
						const { name, listName, notes, dueDate } = args;
						const result = await remindersModule.createReminder(
							name!,
							listName,
							notes,
							dueDate,
						);
						return {
							content: [
								{
									type: "text",
									text: `Created reminder "${result.name}" ${listName ? `in list "${listName}"` : ""}.`,
								},
							],
							success: true,
							reminder: result,
							isError: false,
						};
					} else if (operation === "createWithImage") {
						const { name, imagePath, listName, notes, dueDate } = args;
						if (!name) {
							throw new Error(
								"Name is required for createWithImage operation",
							);
						}
						const result = await remindersModule.createReminderWithImage(
							name,
							imagePath, // undefined = use clipboard
							listName,
							notes,
							dueDate,
						);
						return {
							content: [
								{
									type: "text",
									text: result.message,
								},
							],
							success: result.success,
							usedFallback: result.usedFallback,
							reminder: result.reminder,
							isError: !result.success,
						};
					} else if (operation === "listById") {
						const { listId, props } = args;
						const results = await remindersModule.getRemindersFromListById(
							listId!,
							props,
						);
						return {
							content: [
								{
									type: "text",
									text:
										results.length > 0
											? `Found ${results.length} reminders in list with ID "${listId}".`
											: `No reminders found in list with ID "${listId}".`,
								},
							],
							reminders: results,
							isError: false,
						};
					} else if (operation === "update") {
						const { searchText, listName, newName, newBody, priority, dueDate, completed } = args;
						const result = await remindersModule.updateReminder({
							searchText: searchText!,
							listName,
							newName,
							newBody,
							priority,
							dueDate,
							completed,
						});
						return {
							content: [
								{
									type: "text",
									text: result.message,
								},
							],
							...result,
							isError: !result.success,
						};
					}

					return {
						content: [{ type: "text", text: "Unknown operation" }],
						isError: true,
					};
				} catch (error) {
					console.error("Error in reminders tool:", error);
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						content: [
							{
								type: "text",
								text: errorMessage.includes("access")
									? errorMessage
									: `Error in reminders tool: ${errorMessage}`,
							},
						],
						isError: true,
					};
				}
			}

			default:
				return {
					content: [{ type: "text", text: `Unknown tool: ${name}` }],
					isError: true,
				};
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		};
	}
});

// --- Transport setup ---

console.error("Setting up MCP server transport...");

(async () => {
	try {
		const transport = new StdioServerTransport();

		// Ensure stdout is only used for JSON messages
		const originalStdoutWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
			if (typeof chunk === "string" && !chunk.startsWith("{")) {
				return true;
			}
			return originalStdoutWrite(chunk, encoding, callback);
		};

		await server.connect(transport);
		console.error("Server connected successfully!");
	} catch (error) {
		console.error("Failed to initialize MCP server:", error);
		process.exit(1);
	}
})();

// --- Type guards ---

function isNotesArgs(args: unknown): args is {
	operation: "search" | "list" | "create";
	searchText?: string;
	title?: string;
	body?: string;
	folderName?: string;
} {
	if (typeof args !== "object" || args === null) return false;

	const { operation } = args as { operation?: unknown };
	if (typeof operation !== "string") return false;
	if (!["search", "list", "create"].includes(operation)) return false;

	if (operation === "search") {
		const { searchText } = args as { searchText?: unknown };
		if (typeof searchText !== "string" || searchText === "") return false;
	}

	if (operation === "create") {
		const { title, body } = args as { title?: unknown; body?: unknown };
		if (typeof title !== "string" || title === "" || typeof body !== "string")
			return false;

		const { folderName } = args as { folderName?: unknown };
		if (
			folderName !== undefined &&
			(typeof folderName !== "string" || folderName === "")
		)
			return false;
	}

	return true;
}

function isRemindersArgs(args: unknown): args is {
	operation: "list" | "search" | "open" | "create" | "createWithImage" | "update" | "listById";
	searchText?: string;
	name?: string;
	listName?: string;
	listId?: string;
	props?: string[];
	notes?: string;
	dueDate?: string;
	newName?: string;
	newBody?: string;
	priority?: number;
	completed?: boolean;
	imagePath?: string;
} {
	if (typeof args !== "object" || args === null) return false;

	const { operation } = args as any;
	if (typeof operation !== "string") return false;
	if (!["list", "search", "open", "create", "createWithImage", "update", "listById"].includes(operation))
		return false;

	if (
		(operation === "search" || operation === "open" || operation === "update") &&
		(typeof (args as any).searchText !== "string" ||
			(args as any).searchText === "")
	)
		return false;

	if (
		operation === "create" &&
		(typeof (args as any).name !== "string" || (args as any).name === "")
	)
		return false;

	if (
		operation === "createWithImage" &&
		(typeof (args as any).name !== "string" || (args as any).name === "")
	)
		return false;

	if (
		operation === "listById" &&
		(typeof (args as any).listId !== "string" || (args as any).listId === "")
	)
		return false;

	return true;
}
