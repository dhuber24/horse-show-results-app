/**
 * Turn a backend error body into a sentence a person can read.
 *
 * The backend answers a failed request with `detail` in **two different
 * shapes**, and only one of them is a string. An `HTTPException` raised in a
 * router gives `{"detail": "Class date must be between …"}`; a Pydantic
 * validation failure gives `{"detail": [{type, loc, msg, input, ctx}, …]}` —
 * a list of objects, carrying the submitted body inside each one.
 *
 * Every form in this app was written for the first shape and set the second
 * straight into its error state, which React then refused to render: "Objects
 * are not valid as a React child" is thrown during render, so the screen died
 * on the error boundary instead of printing what was wrong. A validation
 * message must never be able to take the page down — it is the one response
 * whose entire job is to be read.
 *
 * That was not a rare path. On the show's Basics step the only 422 a person can
 * actually provoke is the show's own date range, and they provoke it by moving
 * a show: the new start date is typed before the new end date, so saving in
 * between reversed the range and crashed the screen rather than saying so.
 */

/** One entry of FastAPI's validation `detail` list. */
type ValidationItem = {
  msg?: unknown;
  loc?: unknown;
};

/**
 * Pydantic prefixes a `@model_validator` / `@field_validator` message with
 * "Value error, ", which is a fact about Pydantic rather than about what the
 * person did wrong.
 */
function cleanMessage(msg: string): string {
  return msg.replace(/^(Value|Type|Assertion) error, /, '').trim();
}

/**
 * The field a validation item is about, or null for a whole-body rule.
 *
 * `loc` reads `["body"]` for a model-wide validator and `["body", "name"]` for
 * one field, so the first element is dropped — "body: too long" says nothing a
 * person can act on, where "name: too long" says where to look.
 */
function fieldName(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parts = loc
    .slice(1)
    .filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
    .map(String);
  return parts.length > 0 ? parts.join('.') : null;
}

function fromValidationList(items: unknown[]): string | null {
  const messages: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const { msg, loc } = item as ValidationItem;
    if (typeof msg !== 'string' || !msg.trim()) continue;
    const field = fieldName(loc);
    const text = cleanMessage(msg);
    messages.push(field ? `${field}: ${text}` : text);
  }
  if (messages.length === 0) return null;
  // De-duplicated: one reversed date range can be reported against several
  // fields, and the same sentence three times reads as three problems.
  return Array.from(new Set(messages)).join('; ');
}

/**
 * The message to show for a failed backend call.
 *
 * `body` is whatever `res.json()` produced — including `null`, since the guard
 * every caller uses (`.catch(() => null)`) is what stops an HTML or empty
 * response throwing a parse error over the real one.
 *
 * Always returns a string, so the result is safe to render. `fallback` is used
 * whenever the body carries nothing worth reading.
 */
export function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;

  const { detail, error } = body as { detail?: unknown; error?: unknown };

  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) return fromValidationList(detail) ?? fallback;
  if (detail && typeof detail === 'object') {
    const { msg } = detail as ValidationItem;
    if (typeof msg === 'string' && msg.trim()) return cleanMessage(msg);
  }

  // Next route handlers answer with `{ error: … }` rather than `detail` — an
  // unauthorized call never reaches the backend to be given one.
  if (typeof error === 'string' && error.trim()) return error.trim();

  return fallback;
}
