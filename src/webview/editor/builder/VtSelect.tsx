import Select, {
	type FormatOptionLabelMeta,
	type GroupBase,
	type Props as ReactSelectProps,
	type StylesConfig,
	type ThemeConfig,
} from 'react-select';
import CreatableSelect, { type CreatableProps } from 'react-select/creatable';

/**
 * One option in a {@link VtSelect}. `value` is what the builder stores/emits; `label` is the primary
 * display text; `sublabel` is an optional secondary line (e.g. API name · type) shown only in the
 * dropdown, never in the selected-value chip.
 */
export interface VtSelectOption {
	value: string;
	label: string;
	sublabel?: string;
	isDisabled?: boolean;
}

export type VtSelectGroup = GroupBase<VtSelectOption>;

/** react-select's props for our fixed option/group types, parameterized only by single-vs-multi. */
type BaseProps<IsMulti extends boolean> = ReactSelectProps<VtSelectOption, IsMulti, VtSelectGroup>;

/**
 * Theme + style shims that map react-select onto the surrounding VS Code webview so it reads as a
 * native control in any color theme. Every color is a `--vscode-*` variable (resolved live from the
 * DOM), so the control tracks light / dark / high-contrast without a rebuild. `IsMulti` is erased to
 * `boolean` here — none of these overrides depend on it, and a single shared object keeps the single-
 * and multi-select variants byte-identical.
 */
const vtTheme: ThemeConfig = (theme) => ({
	...theme,
	borderRadius: 4,
	spacing: { ...theme.spacing, controlHeight: 26, baseUnit: 3 },
	colors: {
		...theme.colors,
		primary: 'var(--vscode-focusBorder)',
		primary25: 'var(--vscode-list-hoverBackground)',
		primary50: 'var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))',
		primary75: 'var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))',
		neutral0: 'var(--vscode-input-background)',
		neutral5: 'var(--vscode-input-background)',
		neutral10: 'var(--vscode-badge-background)',
		neutral20: 'var(--vscode-input-border, var(--vscode-panel-border))',
		neutral30: 'var(--vscode-input-border, var(--vscode-panel-border))',
		neutral40: 'var(--vscode-descriptionForeground)',
		neutral50: 'var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground))',
		neutral60: 'var(--vscode-descriptionForeground)',
		neutral80: 'var(--vscode-input-foreground)',
		danger: 'var(--vscode-errorForeground)',
		dangerLight: 'var(--vscode-inputValidation-errorBackground, transparent)',
	},
});

/** Beat Monaco's stacking context: the menu is portaled to `document.body`, so it needs a z-index
 *  above the editor's own high layers to render over the buffer instead of behind it. */
const MENU_PORTAL_Z = 2_147_483_000;

const vtStyles: StylesConfig<VtSelectOption, boolean, VtSelectGroup> = {
	container: (base) => ({
		...base,
		fontFamily: 'var(--vscode-font-family)',
		fontSize: 'var(--vscode-font-size, 13px)',
	}),
	control: (base, state) => ({
		...base,
		minHeight: 26,
		backgroundColor: 'var(--vscode-input-background)',
		borderColor: state.isFocused
			? 'var(--vscode-focusBorder)'
			: 'var(--vscode-input-border, var(--vscode-panel-border))',
		boxShadow: 'none',
		cursor: state.isDisabled ? 'default' : 'pointer',
		// Matches the rest of the webview's disabled convention (e.g. .vt-btn:disabled); react-select's
		// own built-in disabled dimming never applies here since every other style fn below is unconditional.
		opacity: state.isDisabled ? 0.5 : 1,
		':hover': { borderColor: 'var(--vscode-focusBorder)' },
	}),
	// Cap growth so a long chip tray or a wide value list never pushes the panel around.
	valueContainer: (base) => ({ ...base, padding: '1px 6px', maxHeight: '50vh', overflowY: 'auto' }),
	input: (base) => ({ ...base, color: 'var(--vscode-input-foreground)', margin: 0, padding: 0 }),
	singleValue: (base) => ({ ...base, color: 'var(--vscode-input-foreground)' }),
	placeholder: (base) => ({
		...base,
		color: 'var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground))',
	}),
	indicatorsContainer: (base) => ({ ...base, padding: 0 }),
	indicatorSeparator: () => ({ display: 'none' }),
	dropdownIndicator: (base) => ({
		...base,
		padding: 2,
		color: 'var(--vscode-descriptionForeground)',
		':hover': { color: 'var(--vscode-foreground)' },
	}),
	clearIndicator: (base) => ({
		...base,
		padding: 2,
		color: 'var(--vscode-descriptionForeground)',
		':hover': { color: 'var(--vscode-foreground)' },
	}),
	menuPortal: (base) => ({ ...base, zIndex: MENU_PORTAL_Z }),
	menu: (base) => ({
		...base,
		fontFamily: 'var(--vscode-font-family)',
		fontSize: 'var(--vscode-font-size, 13px)',
		backgroundColor: 'var(--vscode-dropdown-background, var(--vscode-input-background))',
		border: '1px solid var(--vscode-dropdown-border, var(--vscode-input-border))',
		boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
	}),
	menuList: (base) => ({ ...base, maxHeight: '50vh', padding: 0 }),
	// Sticky so the group name stays visible while scrolling a long field list.
	groupHeading: (base) => ({
		...base,
		position: 'sticky',
		top: 0,
		zIndex: 1,
		margin: 0,
		padding: '5px 8px',
		fontSize: 10,
		fontWeight: 600,
		letterSpacing: '0.04em',
		color: 'var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground))',
		backgroundColor:
			'var(--vscode-editorWidget-background, var(--vscode-dropdown-background, var(--vscode-input-background)))',
	}),
	group: (base) => ({ ...base, padding: 0 }),
	option: (base, state) => ({
		...base,
		padding: '4px 8px',
		color: 'var(--vscode-foreground)',
		cursor: state.isDisabled ? 'default' : 'pointer',
		backgroundColor: state.isFocused
			? 'var(--vscode-list-hoverBackground)'
			: 'transparent',
		':active': {
			backgroundColor:
				'var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))',
		},
	}),
	multiValue: (base) => ({
		...base,
		backgroundColor: 'var(--vscode-badge-background)',
		borderRadius: 10,
	}),
	multiValueLabel: (base) => ({ ...base, color: 'var(--vscode-badge-foreground)', fontSize: 12 }),
	multiValueRemove: (base) => ({
		...base,
		color: 'var(--vscode-badge-foreground)',
		borderRadius: 10,
		':hover': {
			backgroundColor: 'var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.15))',
			color: 'var(--vscode-badge-foreground)',
		},
	}),
	noOptionsMessage: (base) => ({ ...base, color: 'var(--vscode-descriptionForeground)' }),
};

/** Group header = the group name on the left, its option count on the right. */
function formatGroupLabel(group: VtSelectGroup): JSX.Element {
	return (
		<div style={{ display: 'flex', justifyContent: 'space-between', textTransform: 'uppercase' }}>
			<span>{group.label}</span>
			<span style={{ opacity: 0.7 }}>{group.options.length}</span>
		</div>
	);
}

/** Two-line option in the menu (label + muted sublabel); in the selected chip/value, label only. */
function formatOptionLabel(
	option: VtSelectOption,
	meta: FormatOptionLabelMeta<VtSelectOption>,
): JSX.Element {
	if (meta.context !== 'menu' || !option.sublabel) {
		return <span>{option.label}</span>;
	}
	return (
		<span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
			<span style={{ fontSize: 13 }}>{option.label}</span>
			<span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
				{option.sublabel}
			</span>
		</span>
	);
}

/** Match the typed query against both the visible label and the muted sublabel (which carries the
 *  API name), so searching by API name finds a field/object just as readily as searching by label —
 *  react-select's default filter only inspects the label. Callers can override via `filterOption`. */
function filterOption(
	option: { label: string; value: string; data: VtSelectOption },
	input: string,
): boolean {
	const needle = input.trim().toLowerCase();
	if (needle.length === 0) {
		return true;
	}
	return `${option.label} ${option.data.sublabel ?? ''}`.toLowerCase().includes(needle);
}

/** The `CreatableSelect`-only props we surface; only read when `isCreatable` is set. */
type CreatableExtras<IsMulti extends boolean> = Partial<
	Pick<CreatableProps<VtSelectOption, IsMulti, VtSelectGroup>, 'formatCreateLabel' | 'onCreateOption'>
>;

type Props<IsMulti extends boolean> = BaseProps<IsMulti> &
	CreatableExtras<IsMulti> & {
		/** Render a `CreatableSelect` (type-and-Enter to add ad-hoc values) instead of a plain `Select`. */
		isCreatable?: boolean;
	};

/**
 * The single themed react-select used by every Query Builder combobox (FROM object, SELECT fields,
 * WHERE field / operator / value). It fixes the option shape to {@link VtSelectOption} and layers on
 * the VS Code theme, portaled fixed-position menus (so they escape the scrolling panel and Monaco's
 * stacking context), per-group option counts, sticky group headers, and the two-line option render.
 * Set `isCreatable` for the free-text `CONTAINS` value editor; everything else is a plain select.
 */
export function VtSelect<IsMulti extends boolean = false>({
	isCreatable = false,
	formatCreateLabel,
	onCreateOption,
	...props
}: Props<IsMulti>): JSX.Element {
	const shared: BaseProps<IsMulti> = {
		theme: vtTheme,
		styles: vtStyles as StylesConfig<VtSelectOption, IsMulti, VtSelectGroup>,
		classNamePrefix: 'vt-rs',
		menuPortalTarget: typeof document === 'undefined' ? undefined : document.body,
		menuPosition: 'fixed',
		formatGroupLabel,
		formatOptionLabel,
		filterOption,
		...props,
	};
	if (isCreatable) {
		return (
			<CreatableSelect
				{...shared}
				formatCreateLabel={formatCreateLabel}
				onCreateOption={onCreateOption}
			/>
		);
	}
	return <Select {...shared} />;
}
