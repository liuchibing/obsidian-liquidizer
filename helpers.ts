import { Liquid } from "liquidjs";
import morphdom from "morphdom";
import { App, getFrontMatterInfo, getLinkpath, normalizePath, Notice, Platform } from "obsidian";

export function getLiquid(app: App, stripFrontmatter = true): Liquid {
	return new Liquid({
		extname: ".md",
		fs: {
			exists(filepath: string): Promise<boolean> {
				return app.vault.adapter.exists(normalizePath(filepath));
			},
			existsSync(filepath: string): boolean {
				throw new Error("Function not supported.");
			},
			async readFile(filepath: string): Promise<string> {
				const content = await app.vault.adapter.read(
					normalizePath(filepath)
				);
				if (!stripFrontmatter) {
					return content;
				}
				const frontmatterInfo = getFrontMatterInfo(content);
				return content.slice(frontmatterInfo.contentStart);
			},
			readFileSync(filepath: string): string {
				throw new Error("Function not supported.");
			},
			resolve(root: string, file: string, ext: string): string {
				// console.log({ root, file, ext });
				// 如果file是wikilink格式（例如 [[My Note]]），则提取实际的文件名
				const wikiLinkMatch = file.match(/^\[\[(.+?)\]\]$/);
				if (wikiLinkMatch) {
					const link =
						app.metadataCache.getFirstLinkpathDest(
							wikiLinkMatch[1],
							root
						)?.path || getLinkpath(wikiLinkMatch[1]);
					// console.log({ link });
					file = link;
				}

				// 1. 如果文件路径本身就是绝对路径（以'/'开头），则直接使用它。
				//    否则，将其与 root 路径拼接。
				const basePath = file.startsWith("/")
					? file
					: `${root}/${file}`;

				// 2. 检查路径是否已经有扩展名
				//    简单的检查，可以根据需要做得更复杂
				const hasExtension = /\.[^/.]+$/.test(basePath);

				// 3. 如果没有扩展名且提供了默认扩展名，则添加它
				const fullPath =
					hasExtension || !ext ? basePath : `${basePath}${ext}`;

				// 4. 使用 Obsidian 的 normalizePath 来处理 '..' '///' './' 等，
				//    并返回一个干净的、相对于 vault 根的路径。
				//    例如，'templates/pages/../partials/header.md' 会被正确解析为 'templates/partials/header.md'
				console.log({ normalizePath: normalizePath(fullPath) });
				return normalizePath(fullPath);
			},
			dirname(file) {
				const parts = file.split("/");
				parts.pop();
				return parts.join("/");
			},
			sep: "/",
		},
	});
}

export function diffAndUpdate(oldEl: HTMLElement, newEl: HTMLElement | string) {
	morphdom(oldEl, newEl, {
		onBeforeElUpdated: updateAllowed,
		onBeforeNodeAdded: (el: HTMLElement) =>
			addOrDiscardAllowed(el) ? el : false,
		onBeforeNodeDiscarded: addOrDiscardAllowed,
	});
}

function updateAllowed(fromEl: HTMLElement, toEl: HTMLElement) {
	// spec - https://dom.spec.whatwg.org/#concept-node-equals
	if (fromEl.isEqualNode(toEl)) {
		return false;
	}
	if (fromEl.classList.contains("markdown-preview-section")) {
		return true; // always allow update for the root element
	}
	if (fromEl.classList.contains("liquidized")) {
		return true; // allow update
	}
	return false; // disallow update for other elements
}

function addOrDiscardAllowed(el: HTMLElement) {
	if (!el.classList) return true; // allow addition or discarding of elements without classList (e.g., text nodes)
	if (el.classList.contains("liquidized")) {
		return true; // allow addition or discarding of liquidized elements
	}
	return false; // disallow addition or discarding of other elements
}

/** Diffing algorithm to update only changed parts of the DOM */
export function diffAndUpdate_origin(oldEl: HTMLElement, newEl: HTMLElement) {
	const oldChildren = Array.from(oldEl.childNodes);
	const newChildren = Array.from(newEl.childNodes);
	const maxLength = Math.max(oldChildren.length, newChildren.length);
	for (let i = 0; i < maxLength; i++) {
		const oldChild = oldChildren[i] as HTMLElement;
		const newChild = newChildren[i] as HTMLElement;
		if (!oldChild && newChild) {
			// New child added
			oldEl.appendChild(newChild.cloneNode(true));
		} else if (oldChild && !newChild) {
			// Old child removed
			oldEl.removeChild(oldChild);
		} else if (oldChild && newChild) {
			if (oldChild.isEqualNode(newChild)) {
				// Nodes are identical, do nothing
				continue;
			} else if (
				oldChild.nodeType === Node.TEXT_NODE &&
				newChild.nodeType === Node.TEXT_NODE
			) {
				// Both are text nodes but different, update text
				if (oldChild.textContent !== newChild.textContent) {
					oldChild.textContent = newChild.textContent;
				}
			} else if (
				oldChild.nodeType === Node.ELEMENT_NODE &&
				newChild.nodeType === Node.ELEMENT_NODE
			) {
				// Both are element nodes, recurse
				diffAndUpdate(oldChild as HTMLElement, newChild as HTMLElement);
			} else {
				// Different types of nodes, replace old with new
				oldEl.replaceChild(newChild.cloneNode(true), oldChild);
			}
		}
	}
}

/**
 * 兼容 iOS 的剪贴板复制函数
 */
export function copyToClipboard(text: string) {
	// 判断是否为移动端 (包含 iOS 和 Android，但主要修复 iOS 问题)
	if (Platform.isIosApp) {
		// --- iOS/移动端 专用方案 (模拟 DOM 操作) ---
		const textArea = document.createElement("textarea");
		textArea.value = text;

		// 确保元素不可见，但存在于 DOM 中
		textArea.style.position = "fixed"; // 避免页面滚动
		textArea.style.left = "-9999px";
		textArea.style.top = "0";
		textArea.setAttribute("readonly", ""); // 防止在 iOS 上弹出键盘

		document.body.appendChild(textArea);

		// 选中所有文本
		textArea.select();
		textArea.setSelectionRange(0, 99999); // 专门针对 iOS 的兼容性写法

		try {
			// 执行旧版复制命令
			const successful = document.execCommand("copy");
			if (successful) {
				new Notice("已复制到剪贴板");
			} else {
				new Notice("复制失败");
			}
		} catch (err) {
			console.error("iOS 复制失败", err);
			new Notice("复制出错");
		} finally {
			// 清理 DOM
			document.body.removeChild(textArea);
		}
	} else {
		// --- 桌面端 标准方案 ---
		navigator.clipboard
			.writeText(text)
			.then(() => {
				new Notice("已复制到剪贴板");
			})
			.catch((err) => {
				console.error("复制失败", err);
				new Notice("复制失败");
			});
	}
}
