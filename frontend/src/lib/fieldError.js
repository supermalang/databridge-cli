import { useId, useState } from 'react';

// Accessible per-field validation messaging (WCAG 3.3.1 / 3.3.3 / 4.1.2-4.1.3).
//
// `useFieldErrors()` tracks one error message per field key and hands back:
//   - `fieldProps(key)`     → spread onto the <input>/<select>/<textarea>. When the
//                             field is invalid it sets `aria-invalid="true"` and
//                             `aria-describedby` pointing at the error element's id;
//                             when valid it sets `aria-invalid="false"` and no link.
//   - `errorId(key)`        → the stable, document-unique id of that field's error
//                             element (derived from React's useId, so no two forms or
//                             rows collide).
//   - `errorFor(key)`       → the current error message string (or '').
//   - `setError/clearError` → set or clear a field's error.
//   - `clearAll`            → drop every error (e.g. on a fresh submit pass).
//   - `hasErrors`           → any field currently invalid.
//
// Pair with the <FieldError> element below, which carries `role="alert"` so assistive
// tech announces the message when it appears, and the matching id so the input's
// `aria-describedby` resolves to exactly its own error text.
export function useFieldErrors() {
  const base = useId();
  const [errors, setErrors] = useState({});

  const errorId = (key) => `${base}-${key}-error`;

  const setError = (key, message) =>
    setErrors((prev) => (prev[key] === message ? prev : { ...prev, [key]: message }));

  const clearError = (key) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const clearAll = () => setErrors((prev) => (Object.keys(prev).length ? {} : prev));

  const errorFor = (key) => errors[key] || '';

  const fieldProps = (key) =>
    errors[key]
      ? { 'aria-invalid': 'true', 'aria-describedby': errorId(key) }
      : { 'aria-invalid': 'false' };

  return {
    errors,
    errorId,
    errorFor,
    setError,
    clearError,
    clearAll,
    fieldProps,
    hasErrors: Object.keys(errors).length > 0,
  };
}
