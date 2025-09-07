import { Liquid } from "liquidjs";
import morphdom from "morphdom";

export const liquid = new Liquid();

export function diffAndUpdate(oldEl: HTMLElement, newEl: HTMLElement | string) {
	morphdom(oldEl, newEl, {
		onBeforeElUpdated: updateAllowed,
        onBeforeNodeAdded: (el: HTMLElement) => addOrDiscardAllowed(el) ? el : false,
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
