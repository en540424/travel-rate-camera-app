/**
 * `lib/revenuecat-package-core.ts`の検証
 * （`node --test src/lib/revenuecat-package-core.test.mjs`）。
 *
 * 重点：Dashboardのpackage identifierが独自命名でも月額/年額を解決できること
 * （`offering.monthly` / `.annual`は定義済みidentifier構成でしか埋まらないため）。
 */
import { equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  diagnosePurchaseSetup,
  resolveAnnualPackage,
  resolveMonthlyPackage,
} from './revenuecat-package-core.ts';

const MONTHLY_ID = 'com.estep.travelratecamera.pro.monthly';
const ANNUAL_ID = 'com.estep.travelratecamera.pro.yearly';

const pkg = (identifier, packageType, productId) => ({
  identifier,
  packageType,
  product: { identifier: productId },
});

// ── 1段目: 定義済みidentifier構成 ───────────────────────────

test('resolve*: offering.monthly / annual が埋まっていればそれを使う', () => {
  const monthly = pkg('$rc_monthly', 'MONTHLY', MONTHLY_ID);
  const annual = pkg('$rc_annual', 'ANNUAL', ANNUAL_ID);
  const offering = { availablePackages: [monthly, annual], monthly, annual };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), monthly);
  equal(resolveAnnualPackage(offering, ANNUAL_ID), annual);
});

// ── 2段目: packageTypeへフォールバック ──────────────────────

test('resolve*: 独自identifierでもpackageTypeで解決できる（今回の主目的）', () => {
  const monthly = pkg('Monthly', 'MONTHLY', MONTHLY_ID);
  const annual = pkg('Yearly', 'ANNUAL', ANNUAL_ID);
  // Dashboardが独自identifierだと monthly/annual は null になる
  const offering = { availablePackages: [monthly, annual], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), monthly);
  equal(resolveAnnualPackage(offering, ANNUAL_ID), annual);
});

// ── 3段目: Product IDへフォールバック ───────────────────────

test('resolve*: packageTypeがCUSTOMでもProduct IDで解決できる（最終安全網）', () => {
  const monthly = pkg('my_monthly', 'CUSTOM', MONTHLY_ID);
  const annual = pkg('my_yearly', 'CUSTOM', ANNUAL_ID);
  const offering = { availablePackages: [monthly, annual], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), monthly);
  equal(resolveAnnualPackage(offering, ANNUAL_ID), annual);
});

test('resolve*: packageTypeが一致する方をProduct IDより優先する', () => {
  const byType = pkg('Monthly', 'MONTHLY', 'other.product.id');
  const byProduct = pkg('Custom', 'CUSTOM', MONTHLY_ID);
  const offering = { availablePackages: [byType, byProduct], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), byType);
});

// ── 見つからないケース ──────────────────────────────────────

test('resolve*: 該当が無ければnull（別プランのpackageを誤って返さない）', () => {
  const weekly = pkg('Weekly', 'WEEKLY', 'com.example.weekly');
  const offering = { availablePackages: [weekly], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), null);
  equal(resolveAnnualPackage(offering, ANNUAL_ID), null);
});

test('resolve*: offeringがnull/undefinedならnull', () => {
  equal(resolveMonthlyPackage(null, MONTHLY_ID), null);
  equal(resolveAnnualPackage(undefined, ANNUAL_ID), null);
});

test('resolve*: availablePackagesが空ならnull', () => {
  const offering = { availablePackages: [], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID), null);
  equal(resolveAnnualPackage(offering, ANNUAL_ID), null);
});

test('resolve*: 月額と年額を取り違えない', () => {
  const monthly = pkg('Monthly', 'MONTHLY', MONTHLY_ID);
  const annual = pkg('Yearly', 'ANNUAL', ANNUAL_ID);
  const offering = { availablePackages: [monthly, annual], monthly: null, annual: null };
  equal(resolveMonthlyPackage(offering, MONTHLY_ID).product.identifier, MONTHLY_ID);
  equal(resolveAnnualPackage(offering, ANNUAL_ID).product.identifier, ANNUAL_ID);
});

// ── 診断 ────────────────────────────────────────────────────

test('diagnosePurchaseSetup: 未configureはnot_configured（APIキー未埋め込み等）', () => {
  equal(
    diagnosePurchaseSetup({
      isConfigured: false,
      offering: { availablePackages: [] },
      monthlyResolved: false,
      annualResolved: false,
    }),
    'not_configured',
  );
});

test('diagnosePurchaseSetup: Offering未取得はno_offering', () => {
  equal(
    diagnosePurchaseSetup({
      isConfigured: true,
      offering: null,
      monthlyResolved: false,
      annualResolved: false,
    }),
    'no_offering',
  );
});

test('diagnosePurchaseSetup: 商品0件はno_packages（App Store側の要因）', () => {
  equal(
    diagnosePurchaseSetup({
      isConfigured: true,
      offering: { availablePackages: [] },
      monthlyResolved: false,
      annualResolved: false,
    }),
    'no_packages',
  );
});

test('diagnosePurchaseSetup: 商品はあるが解決不能はpackages_unresolved', () => {
  equal(
    diagnosePurchaseSetup({
      isConfigured: true,
      offering: { availablePackages: [pkg('Weekly', 'WEEKLY', 'x')] },
      monthlyResolved: false,
      annualResolved: false,
    }),
    'packages_unresolved',
  );
});

test('diagnosePurchaseSetup: 片方でも解決できていればok', () => {
  const offering = { availablePackages: [pkg('Monthly', 'MONTHLY', MONTHLY_ID)] };
  equal(
    diagnosePurchaseSetup({ isConfigured: true, offering, monthlyResolved: true, annualResolved: false }),
    'ok',
  );
});
