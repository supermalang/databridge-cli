/**
 * Storybook stories for Skeleton (Tier 2 — VIS-5).
 *
 * Covers the loading shapes actually used across the app: a single skeleton row
 * (Skeleton + SkeletonBlock) and a SkeletonList of several rows. Relies on the
 * Storybook preview's i18n init (VIS-5) so the visually-hidden loading label
 * renders as real English copy ("Loading…") rather than the raw `common.loading`
 * translation key.
 */
import Skeleton, { SkeletonBlock, SkeletonList } from './Skeleton.jsx';

export default {
  title: 'Components/Skeleton',
  component: Skeleton,
};

export const SingleRow = {
  render: () => (
    <Skeleton>
      <SkeletonBlock height={56} />
    </Skeleton>
  ),
};

export const List = {
  render: () => <SkeletonList rows={4} rowHeight={56} gap={10} />,
};
