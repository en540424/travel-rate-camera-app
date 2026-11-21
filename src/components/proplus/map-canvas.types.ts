export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  /** 購入済みの記録がある場所・候補だけの場所・記録の無い場所 */
  kind: 'purchased' | 'candidate' | 'place';
};

export type MapCanvasProps = {
  pins: MapPin[];
  here: { lat: number; lng: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
};
