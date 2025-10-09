import { getLiquid } from "helpers";
import {
	getFrontMatterInfo,
	ItemView,
	MarkdownView,
	Notice,
	parseYaml,
	stringifyYaml,
	WorkspaceLeaf,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";

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
					setTimeout(() => {
						// refresh the view to reflect the updated frontmatter
						this.updateView(file);
					}, 100);
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
							.setValue(variable.currentValue ?? "")
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
					dropdown.selectEl.style.width = "20px";
				});
			}
		});
	}

	async updateFrontmatter(file: TFile, key: string, value: any) {
		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[key] = value;
		});
		setTimeout(() => {
			// refresh the view to reflect the updated frontmatter
			this.updateView(file);
		}, 100);
	}

	async pushToFrontmatterArray(file: TFile, key: string, value: any) {
		this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (!Array.isArray(frontmatter[key])) {
				frontmatter[key] = [];
			}
			frontmatter[key].push(value);
		});
		setTimeout(() => {
			// refresh the view to reflect the updated frontmatter
			this.updateView(file);
		}, 100);
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
		// build result
		const result: FrontmatterVariable[] = [];
		for (const [key, value] of Object.entries(variables)) {
			// determine type: if defined in frontmatter, use its type; else default to string.
			let type: FrontmatterVariable["type"] = frontmatter[key] ? typeof frontmatter[key] : "string";
			if (Array.isArray(frontmatter[key])) {
				type = "array";
			}
			// guess possible options by analyzing the liquid templates
			let possibleOptions: any[] | undefined = undefined;
			// if the variable is used in a conditional statement, we can guess possible options
			// {% if bool_variable %}
			const conditionalRegex = new RegExp(
				`\\{%-?\\s*(if|unless)\\s+${key}\\s*-?%\\}`,
				"g"
			);
			if (conditionalRegex.test(content)) {
				possibleOptions = [true, false];
				type = "boolean"; // correct type to boolean
			}
			// {% if/unless variable == someValue %}
			// {% if/unless variable != someValue %}
			// {% if/unless variable contains someValue %}
			const equalityRegex = new RegExp(
				`\\{%-?\\s*(if|unless)\\s+${key}\\s*(==|!=|contains)\\s*([^\\s%]+)\\s*-?%\\}`,
				"g"
			);
			const matches = content.matchAll(equalityRegex);
			for (const match of matches) {
				if (match[3]) {
					let option: string | boolean | number = match[3];
					// try to parse as number or boolean
					if (option === "true") {
						option = true;
						type = "boolean"; // correct type to boolean
					} else if (option === "false") {
						option = false;
						type = "boolean"; // correct type to boolean
					} else if (!isNaN(Number(option))) {
						option = Number(option);
						type = "number"; // correct type to number
					} else {
						// remove quotes if present
						option = option.replace(/^['"]|['"]$/g, "");
						if (type !== "array") {
							type = "string"; // correct type to string
						}
					}
					if (!possibleOptions) {
						possibleOptions = [];
					}
					if (!possibleOptions.includes(option)) {
						possibleOptions.push(option);
					}
				}
			}
			result.push({
				key,
				type: type as FrontmatterVariable["type"],
				currentValue: frontmatter[key],
				possibleOptions,
			});
		}
		return [result, null];
	}
}

interface FrontmatterVariable {
	key: string;
	type: "string" | "number" | "boolean" | "array" | "object" | "null";
	currentValue: any;
	possibleOptions?: any[];
}
