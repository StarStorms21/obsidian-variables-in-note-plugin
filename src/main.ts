import { App, Editor, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate
} from "@codemirror/view";

import { RangeSetBuilder } from "@codemirror/state";
// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	commands: string[] = ["%v", "%dv"]
	valid_command_regex: RegExp = /%(\w+)\((\w+)(?:\s*,\s*(.*))?\)/g;

	async onload() {
		await this.loadSettings();
		const valid_variable_syntax = /^[A-Za-z][A-Za-z0-9_-]*$/g;
		const style_operators = /[=+\-/%]/g; // + - / %
		const style_commands = /^%\S+/mg; // %dv %v

		this.registerMarkdownPostProcessor((element, ctx) => {
			this.processVariables(element, ctx);
		});

		this.registerEditorExtension([
			this.createRegexHighlighter(/%\w+\([^)]+\)/g, "syn-command-style"),
			//this.createRegexHighlighter(style_operators, "syn-operator-style")
		]);
	}

	processVariables(element: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.sections) return;

		const content = this.app.vault.read(file).then((text) => {
			const variables = this.parseVariables(text);
			this.renderDisplayVariables(element, variables);
		});
	}

	parseVariables(text: string): Record<string, number> {
		const lines = text.split("\n");
		const variables: Record<string, number> = {};

		for (const line of lines) {
			const match = line.match(/%(\w+)\((\w+)(?:\s*,\s*(.*))?\)/);
			if (!match) continue;

			const command = match[1];
			const variable = match[2];
			const args = match[3]
				? match[3].split(",").map(a => a.trim())
				: [];

			//console.log("wow! original:" + line);
			//console.log("wow! com:" + command);
			//console.log("wow! var:" + variable);
			if (!command) continue;
			if (!variable) continue;

			//if (!this.commands.contains(command)) continue; //unknown command
			//console.log("wow! var:" + variable);

			if (command === "v") {
				if (!args || args.length != 1) continue;

				const expression = args.at(0);
				if (!expression) continue;

				const evaluated = this.evaluateExpression(expression, variables);
				if (evaluated !== null) {
					variables[variable] = evaluated;
					console.log("Saved:" + variable + " value:" + evaluated);
				}
			}
		}

		return variables;
	}

	evaluateExpression(expr: string, vars: Record<string, number>): number | null {
		try {
			// Replace variable names with their numeric values
			const replaced = expr.replace(/\b\w+\b/g, (token) => {
				if (vars[token] !== undefined) {
					return vars[token].toString();
				}
				return token;
			});

			// Basic safe arithmetic check
			if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
				return null;
			}

			// Evaluate
			return Function(`"use strict"; return (${replaced});`)();
		} catch {
			return null;
		}
	}

	renderDisplayVariables(element: HTMLElement, vars: Record<string, number>) {
		const walker = document.createTreeWalker(
			element,
			NodeFilter.SHOW_TEXT,
			null
		);

		const nodes: Text[] = [];

		while (walker.nextNode()) {
			nodes.push(walker.currentNode as Text);
		}

		for (const node of nodes) {
			const text = node.nodeValue;
			if (!text) continue;

			const match = text.match(/%(\w+)\((\w+)(?:\s*,\s*(.*?))?\)/);
			if (!match) continue;

			const command = match[1];
			const variable = match[2];
			const args = match[3]
				? match[3].split(",").map(a => a.trim())
				: [];

			if (!command) continue;
			if (!variable) continue;
			if (command == "dv") {
				node.nodeValue = text.replace(
					/%dv\((\w+)\)/g,
					(match, name) => {
						const value = vars[name];
						return value === undefined
							? "%!!UNKNOWN!!%"
							: String(value);
					}
				);
			}
		}
	}

	createRegexHighlighter(
		regex: RegExp,
		className: string
	) {
		return ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = this.buildDecorations(update.view);
					}
				}

				buildDecorations(view: EditorView): DecorationSet {
					const builder = new RangeSetBuilder<Decoration>();

					for (const { from, to } of view.visibleRanges) {
						const text = view.state.doc.sliceString(from, to);

						regex.lastIndex = 0;
						let match: RegExpExecArray | null;

						while ((match = regex.exec(text)) !== null) {
							const start = from + match.index;
							const end = start + match[0].length;

							builder.add(
								start,
								end,
								Decoration.mark({ class: className })
							);
						}
					}

					return builder.finish();
				}
			},
			{
				decorations: v => v.decorations
			}
		);
	}

	//display
	createEditorExtension() {
		return ViewPlugin.fromClass(class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView) {
				const builder = new RangeSetBuilder<Decoration>();

				const regex_dv = /%dv\s+\w+/g;

				for (const { from, to } of view.visibleRanges) {
					const documentText = view.state.doc.sliceString(from, to);

					let match; //the part of the document that actually matches the regex
					while ((match = regex_dv.exec(documentText)) !== null) {
						const start = from + match.index;
						const end = start + match[0].length;

						builder.add(
							start,
							end,
							Decoration.mark({
								class: "syn-dv-style"
							})
						);
					}
				}

				return builder.finish();
			}
		}, {
			decorations: v => v.decorations
		});
	}



	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

