/**
 * Global Storybook preview config.
 *
 * Determinism for visual baselines: animations/transitions are killed so screenshots
 * are reproducible. Playwright also passes `animations: 'disabled'` at capture time —
 * this is belt-and-braces so the interactive workbench and the captured pixels agree.
 */
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
