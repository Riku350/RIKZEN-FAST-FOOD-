import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart, Sparkles } from 'lucide-react';
import { FoodArtIcon, FoodArtKind } from './FoodArtIcons';

interface RikZenIntroProps {
  onComplete: () => void;
  mode?: 'full' | 'quick';
}

interface FloatingIntroItem {
  kind: FoodArtKind;
  positionClass: string;
  enterFrom: { x: number; y: number; rotate: number };
  enterDelay: number;
  floatClass: string;
  sizeClass: string;
  desktopOnly?: boolean;
}

const FLOATING_FOODS: FloatingIntroItem[] = [
  // Primary 4 enter from four distinct directions during 0.45s–1.25s
  {
    kind: 'burger',
    positionClass: 'top-[8%] left-[6%] sm:top-[10%] sm:left-[9%]',
    enterFrom: { x: -70, y: -40, rotate: -22 },
    enterDelay: 0.45,
    floatClass: 'animate-rikzen-float-a',
    sizeClass: 'w-12 h-12 sm:w-16 sm:h-16',
  },
  {
    kind: 'pizza',
    positionClass: 'top-[8%] right-[6%] sm:top-[11%] sm:right-[9%]',
    enterFrom: { x: 70, y: -40, rotate: 24 },
    enterDelay: 0.6,
    floatClass: 'animate-rikzen-sway',
    sizeClass: 'w-12 h-12 sm:w-16 sm:h-16',
  },
  {
    kind: 'fries',
    positionClass: 'bottom-[10%] left-[6%] sm:bottom-[12%] sm:left-[10%]',
    enterFrom: { x: -70, y: 45, rotate: -18 },
    enterDelay: 0.75,
    floatClass: 'animate-rikzen-bob',
    sizeClass: 'w-11 h-11 sm:w-16 sm:h-16',
  },
  {
    kind: 'roll',
    positionClass: 'bottom-[10%] right-[6%] sm:bottom-[12%] sm:right-[10%]',
    enterFrom: { x: 70, y: 45, rotate: 20 },
    enterDelay: 0.9,
    floatClass: 'animate-rikzen-float-b',
    sizeClass: 'w-12 h-12 sm:w-16 sm:h-16',
  },
  // Secondary perimeter food items (kept strictly outside center logo safe zone)
  {
    kind: 'drink',
    positionClass: 'top-[38%] left-[3%] sm:left-[5%]',
    enterFrom: { x: -55, y: 0, rotate: -15 },
    enterDelay: 1.0,
    floatClass: 'animate-rikzen-float-b',
    sizeClass: 'w-10 h-10 sm:w-14 sm:h-14',
  },
  {
    kind: 'lassi',
    positionClass: 'top-[38%] right-[3%] sm:right-[5%]',
    enterFrom: { x: 55, y: 0, rotate: 15 },
    enterDelay: 1.08,
    floatClass: 'animate-rikzen-float-a',
    sizeClass: 'w-10 h-10 sm:w-14 sm:h-14',
  },
  // Desktop-only extra 4 items so mobile stays crisp & fast
  {
    kind: 'chicken',
    positionClass: 'top-[62%] left-[7%]',
    enterFrom: { x: -60, y: 20, rotate: -18 },
    enterDelay: 1.15,
    floatClass: 'animate-rikzen-sway',
    sizeClass: 'w-14 h-14',
    desktopOnly: true,
  },
  {
    kind: 'hotdog',
    positionClass: 'top-[62%] right-[7%]',
    enterFrom: { x: 60, y: 20, rotate: 18 },
    enterDelay: 1.2,
    floatClass: 'animate-rikzen-bob',
    sizeClass: 'w-14 h-14',
    desktopOnly: true,
  },
  {
    kind: 'donut',
    positionClass: 'top-[13%] left-[32%]',
    enterFrom: { x: 0, y: -50, rotate: -20 },
    enterDelay: 1.25,
    floatClass: 'animate-rikzen-float-a',
    sizeClass: 'w-12 h-12',
    desktopOnly: true,
  },
  {
    kind: 'dessert',
    positionClass: 'bottom-[11%] right-[32%]',
    enterFrom: { x: 0, y: 50, rotate: 16 },
    enterDelay: 1.3,
    floatClass: 'animate-rikzen-float-b',
    sizeClass: 'w-12 h-12',
    desktopOnly: true,
  },
];

const LOADER_SEQUENCE: FoodArtKind[] = ['burger', 'fries', 'roll', 'pizza'];

export const RikZenIntro: React.FC<RikZenIntroProps> = ({ onComplete, mode = 'full' }) => {
  const [exiting, setExiting] = useState(false);
  const [loaderStep, setLoaderStep] = useState(0);
  const isQuick = mode === 'quick';

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const totalMs = isQuick ? (prefersReduced ? 500 : 1050) : prefersReduced ? 900 : 3850;
    const exitLeadMs = isQuick ? 240 : 420;

    // Cycle the loading food sequence smoothly
    const seqInterval = window.setInterval(() => {
      setLoaderStep((prev) => (prev + 1) % LOADER_SEQUENCE.length);
    }, isQuick ? 180 : 240);

    const exitTimer = window.setTimeout(() => {
      setExiting(true);
    }, Math.max(200, totalMs - exitLeadMs));

    const doneTimer = window.setTimeout(() => {
      onComplete();
    }, totalMs);

    return () => {
      window.clearInterval(seqInterval);
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onComplete, isQuick]);

  const handleSkip = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(() => onComplete(), 180);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="rikzen-intro-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.02 : 1 }}
        transition={{ duration: exiting ? (isQuick ? 0.22 : 0.38) : isQuick ? 0.2 : 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-50 bg-[#151110] text-white flex items-center justify-center overflow-hidden select-none"
        role="presentation"
        aria-label="Welcome to RikZen Fast Food"
      >
        {/* Soft Premium Radial Glow Backdrop */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, rgba(229, 57, 27, 0.24) 0%, rgba(245, 158, 11, 0.08) 34%, rgba(21, 17, 16, 0.98) 72%)',
          }}
          aria-hidden="true"
        />

        {/* Subtle Glowing Particles, Sparkles, Bubbles & Occasional Hearts (0s+) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {[
            { cls: 'top-[18%] left-[22%] w-2 h-2 bg-amber-400/60', delay: '0s' },
            { cls: 'top-[24%] right-[24%] w-2.5 h-2.5 bg-[#E5391B]/60', delay: '0.6s' },
            { cls: 'bottom-[24%] left-[24%] w-2 h-2 bg-amber-300/50', delay: '1.1s' },
            { cls: 'bottom-[22%] right-[22%] w-2 h-2 bg-orange-400/60', delay: '0.3s' },
            { cls: 'top-[48%] left-[16%] w-3 h-3 bg-white/15', delay: '0.8s' },
            { cls: 'top-[52%] right-[16%] w-3 h-3 bg-white/15', delay: '1.4s' },
          ].map((p, idx) => (
            <span
              key={idx}
              style={{ animationDelay: p.delay }}
              className={`absolute rounded-full animate-rikzen-bubble ${p.cls}`}
            />
          ))}

          <Sparkles
            className="w-4 h-4 text-amber-300/70 absolute top-[20%] left-[44%] animate-rikzen-sparkle"
            style={{ animationDelay: '0.2s' }}
          />
          <Sparkles
            className="w-3.5 h-3.5 text-orange-300/65 absolute bottom-[22%] left-[42%] animate-rikzen-sparkle"
            style={{ animationDelay: '1.0s' }}
          />
          <Heart
            className="w-3.5 h-3.5 text-[#E5391B]/70 fill-current absolute top-[26%] right-[34%] animate-rikzen-bubble"
            style={{ animationDelay: '0.9s' }}
          />
          <Heart
            className="w-3 h-3 text-rose-400/60 fill-current absolute bottom-[26%] left-[33%] animate-rikzen-bubble"
            style={{ animationDelay: '1.6s' }}
          />
        </div>

        {/* Floating Animated Food Perimeter (Never overlaps center branding) */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {FLOATING_FOODS.map((item) => (
            <motion.div
              key={item.kind}
              initial={{
                opacity: 0,
                x: item.enterFrom.x,
                y: item.enterFrom.y,
                rotate: item.enterFrom.rotate,
                scale: 0.72,
              }}
              animate={{
                opacity: 0.94,
                x: 0,
                y: 0,
                rotate: 0,
                scale: 1,
              }}
              transition={{
                delay: item.enterDelay,
                duration: 0.65,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`absolute ${item.positionClass} ${
                item.desktopOnly ? 'hidden md:block' : 'block'
              }`}
            >
              <div
                className={`p-2.5 sm:p-3 rounded-2xl bg-white/[0.06] backdrop-blur-xs border border-white/[0.09] shadow-lg shadow-black/25 ${item.floatClass}`}
                style={{ animationDelay: `${item.enterDelay}s` }}
              >
                <FoodArtIcon kind={item.kind} className={item.sizeClass} />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Center Safe Zone: Main Logo, Tagline, Welcome & Food Loader */}
        <div className="relative z-10 max-w-md w-full mx-auto px-6 text-center flex flex-col items-center">
          {/* Soft Animated Glow Emblem */}
          <motion.div
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: isQuick ? 0.04 : 0.9, duration: isQuick ? 0.28 : 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-5"
          >
            <div
              className="absolute -inset-4 rounded-full bg-[#E5391B]/35 blur-2xl animate-rikzen-glow pointer-events-none"
              aria-hidden="true"
            />
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center shadow-2xl shadow-[#E5391B]/25">
              <FoodArtIcon kind="burger" className="w-12 h-12 sm:w-14 sm:h-14" />
            </div>
          </motion.div>

          {/* Brand Wordmark */}
          <motion.h1
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: isQuick ? 0.08 : 1.05, duration: isQuick ? 0.32 : 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white drop-shadow-[0_0_24px_rgba(229,57,27,0.45)]"
          >
            RIKZEN <span className="text-[#FF5A36]">FAST FOOD</span>
          </motion.h1>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: isQuick ? 0.16 : 1.5, duration: isQuick ? 0.25 : 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2.5 text-sm sm:text-base font-semibold tracking-widest text-amber-200/95"
          >
            Fresh · Fast · Delicious
          </motion.p>

          {/* Welcome Message */}
          {!isQuick && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 2.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mt-4 text-sm sm:text-base font-medium text-neutral-200 inline-flex items-center justify-center gap-1.5"
            >
              <span>Welcome to RikZen Fast Food</span>
              <Heart className="w-4 h-4 text-[#FF5A36] fill-current inline-block" />
            </motion.p>
          )}

          {/* Compact Animated Food Loader Sequence */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: isQuick ? 0.14 : 2.65, duration: isQuick ? 0.2 : 0.35 }}
            className="mt-7 flex flex-col items-center gap-3"
          >
            <div className="flex items-center gap-3">
              {LOADER_SEQUENCE.map((kind, idx) => {
                const isActive = idx === loaderStep;
                return (
                  <div
                    key={kind}
                    className={`transition-all duration-200 ${
                      isActive ? 'scale-125 opacity-100' : 'scale-90 opacity-35'
                    }`}
                  >
                    <FoodArtIcon kind={kind} className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                );
              })}
            </div>

            <div className="w-36 h-1 rounded-full bg-white/15 overflow-hidden">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: isQuick ? 0.85 : 3.4, ease: 'easeInOut' }}
                className="h-full w-full origin-left bg-gradient-to-r from-[#E5391B] to-amber-400"
              />
            </div>
          </motion.div>
        </div>

        {/* Quiet Non-Distracting Skip Control */}
        <button
          type="button"
          onClick={handleSkip}
          className="absolute top-5 right-5 z-20 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white/80 hover:text-white transition-colors cursor-pointer"
        >
          Skip
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
