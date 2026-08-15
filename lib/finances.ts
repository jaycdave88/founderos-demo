/**
 * Finances domain — pure, real-ready. Income flows through a processor/account
 * registry (Stripe wired today; PayPal, FanBasis ×2, Wise ×2 are honest pending
 * slots until their keys land). Expenses come from uploaded statements or not
 * at all.
 *
 * No faked money, and that includes plausible money: an unwired account reports
 * null income rather than a zero that reads as "earned nothing", and an unknown
 * expense total stays null rather than becoming a sample that reads as spend.
 */

// ── Income: processor / account registry ────────────────────────────────────

export type IncomeAccount = {
  id: string;
  processor: string; // 'Stripe' | 'PayPal' | 'FanBasis' | 'Wise'
  label: string; // display label, incl. the business for multi-account processors
  configured: boolean; // does this account have credentials in the env?
  live: boolean; // actually pulling real income right now (Stripe only, for now)
  income: number | null; // month-to-date income in USD (null = pending)
};

/** Recent outgoing transfer (e.g. Wise) — money Alex sent out. */
export type OutgoingTransfer = {
  amountCents: number;
  currency: string;
  status: string;
  created: string | number;
  reference?: string;
};

/**
 * Every processor Alex runs money through. Stripe carries its real
 * month-to-date income when connected; the rest are multi-account-ready slots
 * (two FanBasis for Vantage / Launchpad Cohort, two Wise). `configured` flags
 * which accounts have keys in the env (from `configuredProcessors`); `live`
 * means a real pull is actually happening — true only for Stripe today, so a
 * key-set-but-not-yet-integrated account reads "key set", never a faked number.
 */
export function incomeAccounts(
  stripe: { connected: boolean; mtdUsd: number | null },
  configured: Record<string, boolean> = {},
  liveIncomeUsd: Record<string, number> = {},
): IncomeAccount[] {
  // Non-Stripe accounts light up when a real month-to-date income is supplied
  // (e.g. FanBasis via its customers API); otherwise they're honest pending.
  const account = (id: string, processor: string, label: string): IncomeAccount => {
    const live = liveIncomeUsd[id] != null;
    return {
      id,
      processor,
      label,
      configured: configured[id] ?? false,
      live,
      income: live ? liveIncomeUsd[id] : null,
    };
  };
  return [
    {
      id: 'stripe',
      processor: 'Stripe',
      label: 'Stripe · Launchpad Cohort',
      configured: configured.stripe ?? stripe.connected,
      live: stripe.connected,
      income: stripe.connected ? stripe.mtdUsd : null,
    },
    account('paypal', 'PayPal', 'PayPal'),
    account('fanbasis-vantage', 'FanBasis', 'FanBasis · Vantage'),
    account('fanbasis-lc', 'FanBasis', 'FanBasis · Launchpad Cohort'),
    account('wise-1', 'Wise', 'Wise · Account 1'),
    account('wise-2', 'Wise', 'Wise · Account 2'),
  ];
}

/**
 * Month-to-date income across accounts, or `null` when not one of them is
 * reporting a figure.
 *
 * A sum over no accounts is zero arithmetically and unknown in fact, and on a
 * revenue tile those read as very different things: "$0" says the business
 * earned nothing this month, when what actually happened is that no processor
 * is connected. Accounts still pending are excluded from a real total rather
 * than counted as zeroes that drag it down.
 */
export function totalIncome(accounts: IncomeAccount[]): number | null {
  const reporting = accounts.filter((a) => a.income !== null);
  if (reporting.length === 0) return null;
  return reporting.reduce((sum, a) => sum + (a.income ?? 0), 0);
}

// ── Expenses: uploaded statements, or nothing ───────────────────────────────

/**
 * Net monthly cash flow — income minus expenses, `null` when expenses are not
 * known.
 *
 * A sample expense set used to stand in here, and its total flowed straight
 * into this number and the badge at the top of the page: with no processor
 * connected the dashboard reported a confident ~-$3,900 a month that nobody had
 * spent. Subtracting an unknown does not give you a smaller number, it gives
 * you an unknown, and this returns one so a caller cannot render it as money.
 */
export function net(income: number | null, expenses: number | null): number | null {
  return income === null || expenses === null ? null : income - expenses;
}

// ── Stripe month-to-date helpers (pure; the connector feeds in raw charges) ──

/** Unix seconds for the first instant of `now`'s calendar month (UTC). */
export function monthStartUnix(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

/** Sum only the charges that actually settled (paid + succeeded). */
export function sumChargeIncome(
  charges: { amount: number; currency: string; paid: boolean; status: string }[],
): { amountCents: number; currency: string; count: number } {
  let amountCents = 0;
  let count = 0;
  let currency = 'usd';
  for (const c of charges) {
    if (c.paid && c.status === 'succeeded') {
      amountCents += c.amount;
      count += 1;
      currency = c.currency;
    }
  }
  return { amountCents, currency, count };
}
