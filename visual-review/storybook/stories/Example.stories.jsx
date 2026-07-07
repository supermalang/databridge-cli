/**
 * Example component + states (Tier 2). Each export is a story = one deterministic
 * visual-test target and one interactive workbench view (`npm run storybook`).
 *
 * This is a throwaway placeholder proving the Storybook + visual-baseline wiring
 * works end to end — replace/extend with real component stories under src/ as
 * components get isolated. Keep props FIXED (no live data, timestamps, or random
 * values) so captured pixels stay reproducible across runs.
 */
function ExampleButton({ label, disabled = false }) {
  return (
    <button disabled={disabled} style={{ padding: '8px 16px', borderRadius: 6 }}>
      {label}
    </button>
  );
}

export default {
  title: 'Example/Button',
  component: ExampleButton,
};

export const Primary = { args: { label: 'Save' } };
export const Disabled = { args: { label: 'Save', disabled: true } };
