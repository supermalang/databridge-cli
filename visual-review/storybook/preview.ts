/**
 * Global Storybook preview config.
 *
 * Determinism for visual baselines: animations/transitions are killed so screenshots
 * are reproducible. Playwright also passes `animations: 'disabled'` at capture time —
 * this is belt-and-braces so the interactive workbench and the captured pixels agree.
 *
 * i18n (VIS-5): components like Skeleton call `t('common.loading')` via react-i18next.
 * Outside the real app, react-i18next has no provider/instance, so `t()` returns the
 * raw key. Importing the app's i18n bootstrap here initializes the singleton i18next
 * instance (English resources, per frontend/src/lib/i18n.js) before any story renders,
 * so every story + capture shows real copy ("Loading…") instead of "common.loading".
 *
 * App stylesheet (VIS-5): the design tokens (`:root` custom properties) and base rules
 * both components depend on (`.empty-state-card*`, `.skeleton*`, `.sr-only`) live only in
 * frontend/src/styles.css — nothing else loads it for an isolated Storybook render.
 * Without this import, both components render as unstyled HTML (and `.sr-only` renders
 * fully visible instead of clipped), which would neither look like the real in-app
 * appearance nor produce a meaningful visual baseline.
 */
import '../../frontend/src/lib/i18n.js';
import '../../frontend/src/styles.css';

function disableAnimations() {
  const id = 'visual-testing-no-animations';
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(style);
}

/** @type {import('@storybook/react').Preview} */
const preview = {
  decorators: [
    (Story) => {
      disableAnimations();
      return Story();
    },
  ],
};

export default preview;
