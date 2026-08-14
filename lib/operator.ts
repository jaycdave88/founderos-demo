/**
 * Who this console belongs to.
 *
 * The demo shipped the operator's name inline in the greeting and the org
 * chart, which is fine for a demo and wrong the moment someone else runs it —
 * a dashboard that greets you by a stranger's name is telling you, correctly,
 * that nothing on it is yours.
 *
 * Set FOUNDER_OS_OPERATOR (and optionally FOUNDER_OS_OPERATOR_TITLE) to your
 * own. Unset, it keeps the original demo persona so a fresh clone reads the
 * same as it always did.
 */
export function operatorName(): string {
  return process.env.FOUNDER_OS_OPERATOR?.trim() || 'Alex Rivera';
}

/** First name only — used where the greeting wants to be familiar. */
export function operatorFirstName(): string {
  return operatorName().split(/\s+/)[0] ?? operatorName();
}

export function operatorTitle(): string {
  return process.env.FOUNDER_OS_OPERATOR_TITLE?.trim() || 'Operator';
}
