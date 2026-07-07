/**
 * Storybook config (Tier 2 — component-isolation visual baselines).
 *
 * Relocated from frontend/.storybook/ (VIS-13) into visual-review/storybook/ so all
 * three visual-testing tiers live under one root — see visual-review/README or
 * CLAUDE.md's "Visual testing (VIS-4)" section for the tier map.
 *
 * Adapted from the ai-augmented-coding template's /visual-setup scaffold for this
 * repo's actual stack (React + Vite + plain JSX — no TypeScript, per CLAUDE.md).
 * Stories can live either alongside real components under frontend/src/ (the
 * VIS-5/VIS-6 colocation convention) or, for throwaway harness examples, under
 * ./stories/ — kept out of frontend/src/ so example fixtures never mix with real
 * app code (and so writing them doesn't trip the frontend/src/ roadmap coding-gate).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: [
    '../../frontend/src/**/*.stories.@(js|jsx)',
    './stories/**/*.stories.@(js|jsx)',
  ],
  // Storybook 9+ folded the former @storybook/addon-essentials into core — no
  // separate addon package needed.
  framework: { name: '@storybook/react-vite', options: {} },
  // @storybook/builder-vite defaults Vite's project `root` to the parent of this
  // config directory (visual-review/), which has no node_modules of its own — so
  // resolving frontend deps (e.g. react/jsx-runtime) fails. Point root back at
  // frontend/, where the actual app + its node_modules live, now that this config
  // is relocated out of frontend/.storybook/ (VIS-13).
  async viteFinal(viteConfig) {
    viteConfig.root = resolve(__dirname, '../../frontend');
    return viteConfig;
  },
};

export default config;
