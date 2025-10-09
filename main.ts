import {
	FrontmatterFastEditor,
	VIEW_TYPE_FRONTMATTER_FAST_EDITOR,
} from "frontmatter-fast-editor";
import { diffAndUpdate, getLiquid } from "helpers";
import {
	App,
	getFrontMatterInfo,
	MarkdownView,
	Notice,
	parseYaml,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";

// Remember to rename these classes and interfaces!

interface LiquidizerPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: LiquidizerPluginSettings = {
	mySetting: "default",
};

export default class LiquidizerPlugin extends Plugin {
	settings: LiquidizerPluginSettings;

	// originalOnRender: any = null;

	async onload() {
		await this.loadSettings();

		const exportLiquidRenderedDocument = (checking: boolean) => {
			const markdownView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView && markdownView.file) {
				if (checking) {
					// This command can be run
					return true;
				}
				const filePath = markdownView.file.path.replace(
					".md",
					"_rendered.md"
				);
				this.app.vault
					.read(markdownView.file)
					.then((content) => {
						// get frontmatter info
						const frontmatterInfo = getFrontMatterInfo(content);
						if (!frontmatterInfo.exists) {
							new Notice(
								"Add `liquidize: true` to the frontmatter to enable rendering."
							);
							return Promise.reject(
								new Error("No frontmatter found")
							);
						}
						// parse frontmatter
						const frontmatter = parseYaml(
							frontmatterInfo.frontmatter
						);
						if (!frontmatter.liquidize) {
							new Notice(
								"Add `liquidize: true` to the frontmatter to enable rendering."
							);
							return Promise.reject(
								new Error(
									"`liquidize: true` not found in frontmatter"
								)
							);
						}
						// render content with liquid
						return getLiquid(this.app).parseAndRender(content, {
							...frontmatter,
						});
					})
					.then((rendered) => {
						// if file exists, overwrite it, otherwise create a new file
						this.app.vault.adapter.write(filePath, rendered);
						new Notice("Exported rendered document!");
					})
					.catch((error) => {
						new Notice(
							"Error rendering document: " + error.message
						);
					});

				return true;
			}
			return false;
		};

		// Command: Use liquid to render the current document and export it to a new document
		this.addCommand({
			id: "export-liquid-rendered-document",
			name: "Export Liquid Rendered Document",
			checkCallback: exportLiquidRenderedDocument,
		});

		this.addCommand({
			id: "open-frontmatter-fast-editor",
			name: "Open Frontmatter Fast Editor",
			callback: async () => {
				this.activateView();
			}
		});

		this.addRibbonIcon(
			"file-output",
			"Export Liquid Rendered Document",
			(evt: MouseEvent) => {
				// Use the same logic as the command
				exportLiquidRenderedDocument(false);
			}
		);

		// Try to patch MarkdownPreviewView to support liquid templates in preview mode
		// console.log(MarkdownPreviewView);
		// console.log(MarkdownPreviewView.prototype.onRender);
		// this.originalOnRender = MarkdownPreviewView.prototype.onRender;

		// const localOriginalOnRender = MarkdownPreviewView.prototype.onRender;
		// MarkdownPreviewView.prototype.onRender = function (this: MarkdownPreviewView) {
		// 	const proxyThis = new Proxy(this, {
		// 		get(target, prop, receiver) {
		// 			if (prop === "text") {
		// 				try {
		// 					return liquid.parseAndRenderSync(
		// 						target.text,
		// 						{ ...target.frontmatter }
		// 					);
		// 				} catch (error) {
		// 					console.error("Error rendering liquid template:", error);
		// 				}
		// 			}
		// 			return Reflect.get(target, prop, receiver);
		// 		}
		// 	});
		// 	localOriginalOnRender.apply(proxyThis, arguments);
		// }

		// Register the view (WIP)
		this.registerView(
			VIEW_TYPE_FRONTMATTER_FAST_EDITOR,
			(leaf) => new FrontmatterFastEditor(leaf)
		);
		this.activateView()

		// Provide Live Preview of Liquid Templates
		this.registerMarkdownPostProcessor(async (element, context) => {
			// Check if the frontmatter has a specific flag to enable liquid processing
			if (!context.frontmatter.liquidize) {
				return;
			}
			element.addClass("liquidized");
			element.querySelectorAll("*").forEach((element) => {
				element.classList.add("liquidized");
			});
			if (element.parentElement) {
				const buttons = element.parentElement.getElementsByClassName(
					"liquid-render-button"
				);
				if (buttons.length > 0) {
					// button already exists
					return;
				}
				// Add a button to render the liquid template
				const button = element.createEl("button");
				button.innerText = "Render Liquid Template";
				button.className = "liquid-render-button";
				button.style.marginBottom = "1em";
				button.onclick = async () => {
					const container = button.parentElement?.parentElement;
					if (!container) {
						return;
					}
					try {
						const rendered = await getLiquid(this.app).parseAndRender(
							container.outerHTML,
							{ ...context.frontmatter }
						);
						// Compare the rendered DOM with the current DOM and update only different parts
						// const tempDiv = document.createElement("div");
						// tempDiv.outerHTML = rendered;
						diffAndUpdate(container, rendered);
					} catch (error) {
						new Notice("Error rendering liquid template: " + error);
						console.error(
							"Error rendering liquid template:",
							error
						);
					}
				};
			}
		});

		// when frontmatter changes, re-render the preview
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (
					markdownView &&
					markdownView.file &&
					markdownView.file.path === file.path &&
					markdownView.getMode() === "preview"
				) {
					markdownView.previewMode.rerender(true);
				}
			})
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LiquidizerPluginSettingTab(this.app, this));
	}

	onunload() {
		// if (this.originalOnRender) {
		// 	MarkdownPreviewView.prototype.onRender = this.originalOnRender;
		// }
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_FRONTMATTER_FAST_EDITOR);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_FRONTMATTER_FAST_EDITOR, active: true });
		}

		// // "Reveal" the leaf in case it is in a collapsed sidebar
		// if (leaf) {
		// 	workspace.revealLeaf(leaf);
		// }
	}
}

class LiquidizerPluginSettingTab extends PluginSettingTab {
	plugin: LiquidizerPlugin;

	constructor(app: App, plugin: LiquidizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
