import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, Lock, QrCode } from 'lucide-react';
import { HERO_FEAST_IMAGE, TABLE_NUMBERS } from '../data/menuCatalog';
import { getTableQrUrl } from '../lib/orderService';
import { AmbientFoodBackdrop } from './AmbientFoodBackdrop';
import { FoodImage } from './FoodImage';

interface ShopEntranceProps {
  onNavigate: (path: string) => void;
}

export const ShopEntrance: React.FC<ShopEntranceProps> = ({ onNavigate }) => {
  return (
    <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
      <AmbientFoodBackdrop />
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="font-display text-xl font-extrabold tracking-tight text-neutral-900 whitespace-nowrap shrink-0"
          >
            RikZen <span className="text-[#E5391B]">Fast Food</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600">
            <a href="#qr-tables" className="hover:text-neutral-900 transition-colors whitespace-nowrap shrink-0">
              Table QR Codes
            </a>
            <button
              type="button"
              onClick={() => onNavigate('/menu?table=3')}
              className="hover:text-neutral-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sample Table 3
            </button>
            <a href="#how-it-works" className="hover:text-neutral-900 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
          </nav>

          <button
            type="button"
            onClick={() => onNavigate('/owner')}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            Owner Dashboard
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-14">
        {/* Hero Split */}
        <section className="bg-white rounded-3xl border border-neutral-200 overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-6 p-7 sm:p-10 lg:p-12 flex flex-col justify-center">
            <p className="text-sm font-semibold text-[#E5391B] mb-2">
              QR Table Ordering · Live Kitchen Sync
            </p>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 leading-[1.1] mb-4">
              Scan your table QR. Order in seconds.
            </h1>
            <p className="text-base text-neutral-600 leading-relaxed mb-8 max-w-lg">
              Each of our 6 tables has its own unique QR code. Customers scan to open the menu
              automatically bound to their table, track live kitchen confirmation, and request the
              bill from their phone.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('/menu?table=3')}
                className="min-h-[48px] px-6 py-3 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                Open Table 3 Menu
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/owner')}
                className="min-h-[48px] px-6 py-3 rounded-xl border border-neutral-200 text-neutral-900 font-semibold text-sm hover:bg-neutral-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                Open Owner Live Dashboard
              </button>
            </div>
          </div>
          <div className="lg:col-span-6 aspect-[16/10] lg:aspect-auto lg:min-h-[380px]">
            <FoodImage
              src={HERO_FEAST_IMAGE}
              alt="RikZen Fast Food freshly prepared burger, chicken rolls, peri-peri fries, and mango lassi"
              className="w-full h-full"
              priority
            />
          </div>
        </section>

        {/* 6 Table QR Launchpad */}
        <section id="qr-tables" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                Select Your Table (Tables 1–6)
              </h2>
              <p className="text-sm text-neutral-600 mt-1">
                No login required. Tap your table below or scan your table QR to open the live menu
                immediately.
              </p>
            </div>
            <p className="text-xs font-mono text-neutral-500">/menu?table=1 – 6</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {TABLE_NUMBERS.map((num) => {
              const url = getTableQrUrl(num);
              return (
                <div
                  key={num}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 mb-3">
                    <QrCode className="w-4 h-4 text-[#E5391B]" />
                    <span>RikZen Fast Food</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-neutral-200 mb-4">
                    <QRCodeSVG value={url} size={136} level="M" fgColor="#111827" />
                  </div>
                  <h3 className="text-lg font-extrabold text-neutral-900 mb-1">Table {num}</h3>
                  <p className="text-xs font-mono text-neutral-500 mb-5">/menu?table={num}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate(`/menu?table=${num}`)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-[#E5391B] transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    Open Table {num} Menu
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Simple 3-Step Flow */}
        <section id="how-it-works" className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: '01. Scan & Choose',
              desc: 'Customers scan their table QR code, browse rolls, burgers, snacks, and lassi, and confirm their order in a few taps.',
            },
            {
              step: '02. Live Kitchen Sync',
              desc: 'Orders appear instantly on the secure Owner Dashboard with real-time accept, prepare, and ready updates.',
            },
            {
              step: '03. Instant Bill & Thanks',
              desc: 'Customers tap Request Bill from their seat, receive a clean bill summary, and finish with a thank-you celebration.',
            },
          ].map((item) => (
            <div key={item.step} className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h3 className="text-base font-extrabold text-neutral-900 mb-2">{item.step}</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <span>RikZen Fast Food · Fresh Table Service</span>
          <button
            type="button"
            onClick={() => onNavigate('/owner')}
            className="font-semibold text-neutral-700 hover:text-[#E5391B] cursor-pointer"
          >
            Owner Sign In
          </button>
        </div>
      </footer>
    </div>
  );
};
