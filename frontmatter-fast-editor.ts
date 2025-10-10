import { getLiquid } from "helpers";
import { findLiquidVariableValues } from "liquid-var-utils";
import {
	ItemView,
	MarkdownView,
	Notice,
	WorkspaceLeaf,
	Setting,
	TAbstractFile,
	TFile,
	debounce,
} from "obsidian";

const UPDATE_TIMEOUT = 500;

export const VIEW_TYPE_FRONTMATTER_FAST_EDITOR =
	"liquidizer-frontmatter-fast-editor";

export class FrontmatterFastEditor extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_FRONTMATTER_FAST_EDITOR;
	}

	getDisplayText() {
		return "Liquidizer Frontmatter Fast Editor";
	}

	async onOpen() {
		const file = this.app.workspace.getActiveFile();
		if (file && file instanceof TFile) {
			await this.updateView(file);
		} else {
			this.contentEl.innerHTML =
				"<div>Please open a markdown file to edit its frontmatter.</div>";
		}
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (
					leaf &&
					leaf !== this.leaf &&
					leaf.view instanceof MarkdownView &&
					leaf.view.file &&
					leaf.view.file instanceof TFile
				) {
					this.updateView(leaf.view.file);
				}
			})
		);
		// Register event for file changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (
					markdownView &&
					markdownView.file &&
					file.path === markdownView.file.path
				) {
					debounce(() => {
						// refresh the view to reflect the updated frontmatter
						this.updateView(file);
					}, UPDATE_TIMEOUT, true)();
				}
			})
		);
	}

	async onClose() {}

	async updateView(file: TAbstractFile) {
		if (!(file instanceof TFile)) {
			return;
		}
		const [variables, error] = await this.analyze(file);
		if (error) {
			this.contentEl.innerHTML = `<div style="color: red;">Error: ${error}</div>`;
			return;
		}
		if (!variables || variables.length === 0) {
			this.contentEl.innerHTML =
				"<div>No liquid variables found in the frontmatter.</div>";
			return;
		}
		// build settings UI
		this.contentEl.innerHTML = "";
		variables.forEach((variable) => {
			this.contentEl.createEl("p", { text: variable.key });
			const setting = new Setting(this.contentEl)
				// .setName(variable.key)
				// .setClass("liquidizer-frontmatter-setting");
				// .setDesc(
				// 	variable.possibleOptions
				// 		? `Possible options: ${variable.possibleOptions.join(
				// 				", "
				// 		)}`
				// 		: `Type: ${variable.type}`
				// );
			switch (variable.type) {
				case "string":
					setting.addText((text) =>
						text
							.setValue(String(variable.currentValue) ?? "")
							.onChange(async (value) => {
								await this.updateFrontmatter(
									file,
									variable.key,
									value
								);
							})
					);
					break;
				case "number":
					setting.addText((text) =>
						text
							.setValue(
								variable.currentValue !== undefined
									? String(variable.currentValue)
									: ""
							)
							.onChange(async (value) => {
								const num = Number(value);
								if (isNaN(num)) {
									new Notice("Please enter a valid number");
									return;
								}
								await this.updateFrontmatter(
									file,
									variable.key,
									num
								);
							})
					);
					break;
				case "boolean":
					setting.addToggle((toggle) =>
						toggle
							.setValue(Boolean(variable.currentValue))
							.onChange(async (value) => {
								await this.updateFrontmatter(
									file,
									variable.key,
									value
								);
							})
					);
					break;
				case "array":
					setting.addTextArea((text) =>
						text
							.setValue(
								Array.isArray(variable.currentValue)
									? variable.currentValue.join("\n")
									: ""
							)
							.onChange(async (value) => {
								const arr = value
									.split("\n")
									.map((v) => v.trim())
									.filter((v) => v.length > 0);
								await this.updateFrontmatter(
									file,
									variable.key,
									arr
								);
							})
					);
					break;
				default:
					setting.addText((text) =>
						text
							.setValue(
								variable.currentValue !== undefined
									? String(variable.currentValue)
									: ""
							)
							.onChange(async (value) => {
								await this.updateFrontmatter(
									file,
									variable.key,
									value
								);
							})
					);
					break;
			}
			if (variable.possibleOptions && variable.possibleOptions.length > 0 && variable.type !== "boolean") {
				setting.addDropdown((dropdown) => {
					dropdown.addOption("", "Select an option");
					variable.possibleOptions?.forEach((option) => {
						dropdown.addOption(String(option), String(option));
					});
					dropdown.onChange(async (value) => {
						switch (variable.type) {
							case "number":
								await this.updateFrontmatter(
									file,
									variable.key,
									Number(value)
								);
								break;
							case "array":
								await this.pushToFrontmatterArray(
									file,
									variable.key,
									value
								);
								break;
							default:
								await this.updateFrontmatter(
									file,
									variable.key,
									value
								);
						}
					});
					dropdown.selectEl.addClass("liquidizer-frontmatter-dropdown-select");
				});
			}
		});
	}

	async updateFrontmatter(file: TFile, key: string, value: any) {
		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[key] = value;
		});
		debounce(() => {
			// refresh the view to reflect the updated frontmatter
			this.updateView(file);
		}, UPDATE_TIMEOUT, true)();
	}

	async pushToFrontmatterArray(file: TFile, key: string, value: any) {
		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (!Array.isArray(frontmatter[key])) {
				frontmatter[key] = [];
			}
			frontmatter[key].push(value);
		});
		debounce(() => {
			// refresh the view to reflect the updated frontmatter
			this.updateView(file);
		}, UPDATE_TIMEOUT, true)();
	}

	async analyze(
		file: TFile
	): Promise<[FrontmatterVariable[] | null, string | null]> {
		// parse file content and frontmatter
		const content = await this.app.vault.cachedRead(file);
		// const frontmatterInfo = getFrontMatterInfo(content);
		// if (!frontmatterInfo.exists) {
		// 	return [
		// 		null,
		// 		"No frontmatter found. Please add frontmatter to the file.",
		// 	];
		// }
		const frontmatter =
			this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			return [null, "Failed to get frontmatter."];
		}
		// check if liquidize is true
		if (!frontmatter.liquidize) {
			return [
				null,
				"Liquidizer is not enabled for this file. Please add `liquidize: true` to the frontmatter.",
			];
		}
		// analyze file content to find liquid variables using liquidjs
		const liquidAnalysis = await getLiquid(this.app).parseAndAnalyze(
			content
		);
		if (!liquidAnalysis) {
			return [null, "Failed to analyze liquid content."];
		}
		const variables = liquidAnalysis.globals;
		if (!variables || Object.keys(variables).length === 0) {
			return [null, "No liquid variables found in the content."];
		}
		const variableValues = findLiquidVariableValues(Object.keys(variables), content);
		// build FrontmatterVariable array
		const result: FrontmatterVariable[] = [];
		for (const key in variableValues) {
			const currentValue = frontmatter[key];
			let type: FrontmatterVariable["type"] = "string";
			// determine type based on possible values and current value
			if (Array.isArray(currentValue)) {
				type = "array";
			} else if (currentValue === null) {
				type = "null";
			} else if (typeof currentValue === "object") {
				type = "object";
			} else if (typeof currentValue === "number") {
				type = "number";
			} else if (typeof currentValue === "boolean") {
				type = "boolean";
			} else if (variableValues[key].length === 0) {
				type = "string";
			} else if (variableValues[key].every(v => typeof v === "number")) {
				type = "number";
			} else if (variableValues[key].every(v => typeof v === "boolean")) {
				type = "boolean";
			} else if (variableValues[key].every(v => v === null)) {
				type = "null";
			} else if (variableValues[key].every(v => typeof v === "object")) {
				type = "object";
			}
			
			result.push({
				key,
				type,
				currentValue,
				possibleOptions: variableValues[key],
			});
		}
		return [result, null];
	}
}

interface FrontmatterVariable {
	key: string;
	type: "string" | "number" | "boolean" | "array" | "object" | "null";
	currentValue: unknown;
	possibleOptions?: unknown[];
}
