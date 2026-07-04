/**
 * Storybook config (Tier 2 — component-isolation visual baselines).
 *
 * Adapted from the ai-augmented-coding template's /visual-setup scaffold for this
 * repo's actual stack (React + Vite + plain JSX — no TypeScript, per CLAUDE.md).
 * Stories can live either alongside real components under src/ or, for throwaway
 * examples, under tests/storybook/ — kept out of src/ so example fixtures never
 * mix with real app code (and so writing them doesn't trip the frontend/src/
 * roadmap coding-gate).
 */
/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: [
    '../src/**/*.stories.@(js|jsx)',
    '../tests/storybook/**/*.stories.@(js|jsx)',
  ],
  // Storybook 9+ folded the former @storybook/addon-essentials into core — no
  // separate addon package needed.
  framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
