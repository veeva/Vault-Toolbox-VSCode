import { GlobalStyles } from './editor/GlobalStyles';
import { TabShell } from './shell/TabShell';

/** Webview root: global styles + the tabbed sidebar shell (VQL today; more features as tabs). */
export function App(): JSX.Element {
	return (
		<>
			<GlobalStyles />
			<TabShell />
		</>
	);
}
