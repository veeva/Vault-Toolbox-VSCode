import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type RefObject,
	type SetStateAction,
} from 'react';

/** Space kept between the menu and the viewport edge when clamping its position. */
const VIEWPORT_MARGIN = 8;

/** Vertical gap between the toggle button's bottom edge and the top of the menu. */
const MENU_GAP = 4;

/** Smallest height the menu is ever clamped to, so it stays usable in a very short panel. */
const MIN_MENU_HEIGHT = 80;

export interface DropdownMenu {
	open: boolean;
	setOpen: Dispatch<SetStateAction<boolean>>;
	rootRef: RefObject<HTMLDivElement>;
	menuRef: RefObject<HTMLDivElement>;
}

/**
 * Shared behavior for the editor's floating dropdown menus (History, Saved): open/close state,
 * viewport-anchored positioning that keeps the menu fully on-screen, and close-on-outside-click/Escape.
 *
 * The menu uses `position: fixed` so no `overflow: hidden` ancestor can clip it, and is placed each
 * layout from the toggle button's bounding rect. Because the toggle can sit anywhere along the toolbar
 * in a panel of any size, `clampPosition` corrects two ways it could escape the viewport: horizontally
 * it shifts the menu left when its right edge would overflow (never past the panel's own left edge),
 * and vertically it caps `max-height` when the menu's bottom would fall below the viewport. It re-runs
 * on `resize` and `scroll` so the menu keeps tracking its button as the panel changes while open.
 */
export function useDropdownMenu(): DropdownMenu {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const menu = menuRef.current;
		const root = rootRef.current;
		if (!open || !menu || !root) {
			return;
		}

		// The menu uses position:fixed so it is not clipped by any overflow:hidden ancestor.
		// Compute its top/left in viewport coordinates from the toggle button's bounding rect,
		// then clamp max-height and horizontal position so the menu stays fully on-screen.
		const clampPosition = () => {
			const rootRect = root.getBoundingClientRect();
			menu.style.top = `${rootRect.bottom + MENU_GAP}px`;
			menu.style.left = `${rootRect.left}px`;

			// Vertical: reset any prior override, then measure the actual rendered bottom and
			// cap only if it escapes the viewport (works regardless of box-sizing on the menu).
			menu.style.maxHeight = '';
			const afterReset = menu.getBoundingClientRect();
			const verticalOverflow = afterReset.bottom - (window.innerHeight - VIEWPORT_MARGIN);
			if (verticalOverflow > 0) {
				menu.style.maxHeight = `${Math.max(MIN_MENU_HEIGHT, afterReset.height - verticalOverflow)}px`;
			}

			// Horizontal: shift left to keep the right edge on-screen.
			const menuRect = menu.getBoundingClientRect();
			const overflow = menuRect.right - (window.innerWidth - VIEWPORT_MARGIN);
			if (overflow > 0) {
				const clampedLeft = Math.max(VIEWPORT_MARGIN, rootRect.left - overflow);
				menu.style.left = `${clampedLeft}px`;
			}
		};

		clampPosition();
		// Track the button as the panel changes: resize reflows the toolbar, and scroll (captured, so
		// it also catches scrolling on inner containers) moves the button under the fixed-position menu.
		window.addEventListener('resize', clampPosition);
		window.addEventListener('scroll', clampPosition, true);
		return () => {
			window.removeEventListener('resize', clampPosition);
			window.removeEventListener('scroll', clampPosition, true);
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointerDown = (event: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	return { open, setOpen, rootRef, menuRef };
}
