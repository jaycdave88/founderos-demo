import { describe, expect, test } from 'vitest';
import {
  incomeAccounts,
  totalIncome,
  net,
  monthStartUnix,
  sumChargeIncome,
} from '@/lib/finances';

describe('incomeAccounts', () => {
  test('lists every processor Alex runs (Stripe, PayPal, FanBasis×2, Wise×2)', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts).toHaveLength(6);
    expect(accounts.map((a) => a.id)).toEqual([
      'stripe',
      'paypal',
      'fanbasis-vantage',
      'fanbasis-lc',
      'wise-1',
      'wise-2',
    ]);
  });

  test('Stripe goes live with its real month-to-date income when connected', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    const stripe = accounts.find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(true);
    expect(stripe.income).toBe(7000);
  });

  test('unwired processors are honest pending — null income, not a faked zero', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(accounts.find((a) => a.id === 'paypal')!.income).toBeNull();
    expect(accounts.find((a) => a.id === 'wise-1')!.live).toBe(false);
  });

  test('Stripe stays pending when not connected', () => {
    const stripe = incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(false);
    expect(stripe.income).toBeNull();
  });

  test('non-Stripe accounts derive `configured` from the passed config map (key set ≠ live pull)', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { paypal: true, 'wise-1': true });
    const paypal = accounts.find((a) => a.id === 'paypal')!;
    expect(paypal.configured).toBe(true); // key present
    expect(paypal.live).toBe(false); // but no real pull implemented yet
    expect(paypal.income).toBeNull(); // so never a faked number
    expect(accounts.find((a) => a.id === 'wise-1')!.configured).toBe(true);
    expect(accounts.find((a) => a.id === 'fanbasis-lc')!.configured).toBe(false);
  });

  test('stripe.configured defaults to its connection state', () => {
    expect(incomeAccounts({ connected: true, mtdUsd: 100 }).find((a) => a.id === 'stripe')!.configured).toBe(true);
    expect(incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!.configured).toBe(false);
  });

  test('a non-Stripe account goes live with real income when passed in liveIncomeUsd', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { 'fanbasis-lc': true }, { 'fanbasis-lc': 3400 });
    const aa = accounts.find((a) => a.id === 'fanbasis-lc')!;
    expect(aa.configured).toBe(true);
    expect(aa.live).toBe(true);
    expect(aa.income).toBe(3400);
    // others still pending
    expect(accounts.find((a) => a.id === 'paypal')!.live).toBe(false);
  });
});

describe('totalIncome', () => {
  test('sums the accounts that are reporting, ignoring the pending ones', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(totalIncome(accounts)).toBe(7000);
  });

  // "$0 income" and "no processor connected" are different claims, and only one
  // of them is true on a fresh install.
  test('no account reporting is unknown income, not zero', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts.every((a) => a.income === null)).toBe(true);
    expect(totalIncome(accounts)).toBeNull();
  });
});

describe('net', () => {
  test('income minus expenses, positive or negative', () => {
    expect(net(150, 100)).toBe(50);
    expect(net(100, 150)).toBe(-50);
  });

  // A sample expense set used to stand in for the real one, and its total fed
  // straight into this number: with no processor connected the page reported a
  // confident monthly loss nobody had made. Unknown out means unknown net.
  test('unknown expenses give an unknown net, never a confident number', () => {
    expect(net(150, null)).toBeNull();
    expect(net(0, null)).toBeNull();
  });

  test('unknown income does too — an unconnected processor is not zero revenue', () => {
    expect(net(null, 100)).toBeNull();
    expect(net(null, null)).toBeNull();
  });
});

describe('Stripe month-to-date helpers', () => {
  test('monthStartUnix returns the first of the calendar month at 00:00 UTC', () => {
    const unix = monthStartUnix(new Date('2026-06-16T10:30:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('sumChargeIncome counts only paid + succeeded charges', () => {
    const result = sumChargeIncome([
      { amount: 5000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 2000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 9999, currency: 'usd', paid: false, status: 'failed' },
      { amount: 100, currency: 'usd', paid: true, status: 'pending' },
    ]);
    expect(result).toEqual({ amountCents: 7000, currency: 'usd', count: 2 });
  });
});
