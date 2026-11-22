import React from 'react';
import { Sparkles } from 'lucide-react';
import { FoodArtIcon, FoodArtKind } from './FoodArtIcons';

interface AmbientItem {
  kind: FoodArtKind;
  positionClass: string;
  animClass: string;
  delay: string;
  sizeClass: string;
  desktopOnly?: boolean;
}

const AMBIENT_ITEMS: AmbientItem[] = [
  // 4 subtle corner anchors (visible on mobile & desktop, never blocking cards or nav)
  {
    kind: 'pizza',
    positionClass: 'top-20 left-2 sm:left-4',
    animClass: 'animate-rikzen-sway',
    delay: '0s',
    sizeClass: 'w-8 h-8 sm:w-11 sm:h-11',
  },
  {
    kind: 'fries',
    positionClass: 'top-24 right-2 sm:right-5',
    animClass: 'animate-rikzen-float-a',
    delay: '0.8s',
    sizeClass: 'w-8 h-8 sm:w-11 sm:h-11',
  },
  {
    kind: 'burger',
    positionClass: 'bottom-20 left-2 sm:bottom-10 sm:left-5',
    animClass: 'animate-rikzen-bob',
    delay: '1.4s',
    sizeClass: 'w-8 h-8 sm:w-12 sm:h-12',
  },
  {
    kind: 'drink',
    positionClass: 'bottom-20 right-2 sm:bottom-10 sm:right-5',
    animClass: 'animate-rikzen-float-b',
    delay: '0.4s',
    sizeClass: 'w-8 h-8 sm:w-11 sm:h-11',
  },
  // 4 additional desktop side-gutter accents
  {
    kind: 'roll',
    positionClass: 'top-[46%] left-3',
    animClass: 'animate-rikzen-float-b',
    delay: '1.1s',
    sizeClass: 'w-10 h-10',
    desktopOnly: true,
  },
  {
    kind: 'lassi',
    positionClass: 'top-[48%] right-3',
    animClass: 'animate-rikzen-float-a',
    delay: '1.8s',
    sizeClass: 'w-10 h-10',
    desktopOnly: true,
  },
  {
    kind: 'chicken',
    positionClass: 'top-[72%] left-4',
    animClass: 'animate-rikzen-sway',
    delay: '2.2s',
    sizeClass: 'w-10 h-10',
    desktopOnly: true,
  },
  {
    kind: 'dessert',
    positionClass: 'top-[70%] right-4',
    animClass: 'animate-rikzen-bob',
    delay: '0.9s',
    sizeClass: 'w-10 h-10',
    desktopOnly: true,
  },
];

export const AmbientFoodBackdrop: React.FC = () => {
  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none"
      aria-hidden="true"
    >
      {AMBIENT_ITEMS.map((item) => (
        <div
          key={item.kind}
          style={{ animationDelay: item.delay }}
          className={`absolute opacity-[0.16] sm:opacity-[0.18] ${item.positionClass} ${item.animClass} ${
            item.desktopOnly ? 'hidden xl:block' : 'block'
          }`}
        >
          <FoodArtIcon kind={item.kind} className={item.sizeClass} />
        </div>
      ))}

      {/* Subtle corner sparkles */}
      <Sparkles
        className="w-3.5 h-3.5 text-[#E5391B]/25 absolute top-32 left-10 animate-rikzen-sparkle hidden lg:block"
        style={{ animationDelay: '0.5s' }}
      />
      <Sparkles
        className="w-3.5 h-3.5 text-amber-500/30 absolute bottom-28 right-12 animate-rikzen-sparkle hidden lg:block"
        style={{ animationDelay: '1.5s' }}
      />
    </div>
  );
};
