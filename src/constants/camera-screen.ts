/** Phase A: UI表示用モック（DB・store 未連携） */

export const DEMO_TRIP_NAME = 'ハワイ旅行';

/** 旅行予算（円）— 将来は旅行データと連携 */
export const MOCK_TRIP_BUDGET_JPY = 50_000;

export const CAMERA_UI = {
  bg: '#EEF2F7',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  text: '#1C1C1E',
  textSecondary: '#5C6570',
  textMuted: '#94A3B8',
  brand: '#208AEF',
  brandSoft: '#E8F3FE',
  budgetBar: '#208AEF',
  budgetBarTrack: '#E2E8F0',
} as const;
