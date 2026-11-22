import React from 'react';

export type FoodArtKind =
  | 'burger'
  | 'pizza'
  | 'hotdog'
  | 'roll'
  | 'fries'
  | 'chicken'
  | 'drink'
  | 'lassi'
  | 'donut'
  | 'dessert';

interface FoodArtProps {
  kind: FoodArtKind;
  className?: string;
}

export const FoodArtIcon: React.FC<FoodArtProps> = ({ kind, className = 'w-12 h-12' }) => {
  switch (kind) {
    case 'burger':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <path d="M10 30C10 17 20 12 32 12C44 12 54 17 54 30H10Z" fill="#F59E0B" />
          <path d="M12 28C14 19 22 15 32 15C42 15 50 19 52 28" fill="#FBBF24" />
          <circle cx="23" cy="20" r="1.6" fill="#FEF3C7" />
          <circle cx="32" cy="18" r="1.6" fill="#FEF3C7" />
          <circle cx="41" cy="21" r="1.6" fill="#FEF3C7" />
          <path d="M8 32C12 29 16 35 20 32C24 29 28 35 32 32C36 29 40 35 44 32C48 29 52 35 56 32V36H8V32Z" fill="#22C55E" />
          <rect x="9" y="35" width="46" height="8" rx="4" fill="#7C2D12" />
          <path d="M13 35L21 41L29 35L37 40L45 35L51 39V35H13Z" fill="#FACC15" />
          <rect x="10" y="43" width="44" height="9" rx="4.5" fill="#D97706" />
        </svg>
      );

    case 'pizza':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <path d="M12 16C25 10 39 10 52 16L32 56L12 16Z" fill="#FACC15" />
          <path d="M10 17C24 10 40 10 54 17L51 23C39 17 25 17 13 23L10 17Z" fill="#D97706" />
          <circle cx="26" cy="27" r="4.2" fill="#DC2626" />
          <circle cx="39" cy="29" r="3.8" fill="#DC2626" />
          <circle cx="32" cy="41" r="4" fill="#DC2626" />
          <circle cx="33" cy="24" r="2" fill="#16A34A" />
          <circle cx="27" cy="36" r="1.8" fill="#16A34A" />
        </svg>
      );

    case 'hotdog':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <g transform="rotate(-24 32 32)">
            <rect x="7" y="23" width="50" height="18" rx="9" fill="#F59E0B" />
            <rect x="4" y="27" width="56" height="10" rx="5" fill="#B91C1C" />
            <path d="M11 32C15 28 19 36 23 32C27 28 31 36 35 32C39 28 43 36 47 32C50 29 52 32 54 32" stroke="#FACC15" strokeWidth="2.8" strokeLinecap="round" />
          </g>
        </svg>
      );

    case 'roll':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <g transform="rotate(-28 32 32)">
            <rect x="18" y="10" width="28" height="44" rx="12" fill="#FDE68A" />
            <path d="M18 32H46V44C46 50 41 54 35 54H29C23 54 18 50 18 44V32Z" fill="#FFFFFF" />
            <path d="M18 35H46" stroke="#E5391B" strokeWidth="2.5" strokeDasharray="4 3" />
            <ellipse cx="32" cy="14" rx="11" ry="5" fill="#B45309" />
            <circle cx="28" cy="14" r="3" fill="#22C55E" />
            <circle cx="35" cy="13" r="3.2" fill="#DC2626" />
            <path d="M23 21L41 25" stroke="#D97706" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          </g>
        </svg>
      );

    case 'fries':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <rect x="17" y="13" width="5.5" height="24" rx="2.5" fill="#FACC15" />
          <rect x="24" y="9" width="5.5" height="28" rx="2.5" fill="#FDE047" />
          <rect x="31" y="11" width="5.5" height="26" rx="2.5" fill="#F59E0B" />
          <rect x="38" y="8" width="5.5" height="29" rx="2.5" fill="#FACC15" />
          <rect x="44" y="15" width="5.5" height="22" rx="2.5" fill="#FBBF24" />
          <path d="M13 28H51L46 55H18L13 28Z" fill="#E5391B" />
          <path d="M22 28C25 34 39 34 42 28" fill="#B91C1C" />
          <circle cx="32" cy="43" r="5" fill="#FDE047" />
        </svg>
      );

    case 'chicken':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <g transform="rotate(-22 32 32)">
            <rect x="34" y="34" width="17" height="7" rx="3.5" fill="#FEF3C7" />
            <circle cx="51" cy="34.5" r="3.8" fill="#FEF3C7" />
            <circle cx="51" cy="40.5" r="3.8" fill="#FEF3C7" />
            <path d="M12 29C12 19 21 15 31 18C39 20 43 27 42 35C41 42 33 46 25 45C17 44 12 38 12 29Z" fill="#D97706" />
            <path d="M17 26C19 21 25 19 31 21" stroke="#FDE68A" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
            <circle cx="24" cy="31" r="2" fill="#92400E" />
            <circle cx="32" cy="34" r="1.8" fill="#92400E" />
          </g>
        </svg>
      );

    case 'drink':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <path d="M35 8L43 8L37 22" stroke="#E5391B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 22H45L41 55H23L19 22Z" fill="#E5391B" />
          <rect x="17" y="18" width="30" height="5" rx="2.5" fill="#FFFFFF" />
          <path d="M21 35H43L42 44H22L21 35Z" fill="#FFFFFF" opacity="0.92" />
          <circle cx="32" cy="39.5" r="3" fill="#E5391B" />
        </svg>
      );

    case 'lassi':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <path d="M20 18H44L41 54C41 55.5 39.5 56 38 56H26C24.5 56 23 55.5 23 54L20 18Z" fill="#FBBF24" />
          <ellipse cx="32" cy="18" rx="12" ry="4" fill="#FEF3C7" />
          <circle cx="28" cy="17.5" r="2" fill="#16A34A" />
          <circle cx="34" cy="18.5" r="1.8" fill="#16A34A" />
          <path d="M31 16L36 14" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M24 25L26 48" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
        </svg>
      );

    case 'donut':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <circle cx="32" cy="32" r="21" fill="#D97706" />
          <path d="M13 30C14 19 22 12 32 12C43 12 51 20 51 31C48 35 44 33 41 36C38 39 34 36 31 38C28 40 24 35 20 37C16 39 12 34 13 30Z" fill="#F43F5E" />
          <circle cx="32" cy="32" r="7.5" fill="#141110" fillOpacity="0.22" />
          <circle cx="32" cy="32" r="6" fill="#F8F9FA" />
          <rect x="22" y="18" width="5" height="2.2" rx="1.1" transform="rotate(-20 22 18)" fill="#FACC15" />
          <rect x="37" y="17" width="5" height="2.2" rx="1.1" transform="rotate(25 37 17)" fill="#FFFFFF" />
          <rect x="42" y="26" width="5" height="2.2" rx="1.1" transform="rotate(-15 42 26)" fill="#38BDF8" />
          <rect x="19" y="28" width="5" height="2.2" rx="1.1" transform="rotate(30 19 28)" fill="#A3E635" />
        </svg>
      );

    case 'dessert':
      return (
        <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
          <path d="M22 33H42L32 57L22 33Z" fill="#D97706" />
          <path d="M25 39L39 39M27 45L37 45" stroke="#B45309" strokeWidth="1.8" />
          <circle cx="32" cy="26" r="12" fill="#FEF3C7" />
          <circle cx="24" cy="29" r="7" fill="#F472B6" />
          <circle cx="40" cy="29" r="7" fill="#FDE047" />
          <circle cx="32" cy="13" r="4" fill="#DC2626" />
          <path d="M32 9C33 7 35 6 37 6" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
};
