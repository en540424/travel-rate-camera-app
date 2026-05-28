import { create } from 'zustand';

import type { TripRow } from '@/db/queries/trips';

interface TripStore {
  /** 現在選択中の旅行。null = 未選択 */
  activeTrip: TripRow | null;
  setActiveTrip: (trip: TripRow | null) => void;
}

export const useTripStore = create<TripStore>((set) => ({
  activeTrip: null,
  setActiveTrip: (trip) => set({ activeTrip: trip }),
}));
