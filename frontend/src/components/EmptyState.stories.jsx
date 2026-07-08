/**
 * Storybook stories for EmptyState (Tier 2 — VIS-5).
 *
 * Covers the two AC-required variants: with an action control, and without one.
 * Props are fixed (no live data/timestamps) so captured pixels stay reproducible.
 */
import EmptyState from './EmptyState.jsx';

export default {
  title: 'Components/EmptyState',
  component: EmptyState,
};

export const WithAction = {
  args: {
    title: 'No reports yet',
    description: 'Run a build to generate your first report.',
    action: <button type="button">Build report</button>,
  },
};

export const WithoutAction = {
  args: {
    title: 'No submissions found',
    description: 'Try adjusting your filters or download fresh data.',
  },
};
