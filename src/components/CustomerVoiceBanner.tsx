import React, { useEffect, useState } from 'react';
import { CheckCircle2, Volume2, VolumeX } from 'lucide-react';
import { customerVoiceManager, CustomerVoiceState } from '../lib/customerVoiceManager';

interface CustomerVoiceBannerProps {
  compact?: boolean;
}

export const CustomerVoiceBanner: React.FC<CustomerVoiceBannerProps> = ({ compact = false }) => {
  const [voiceState, setVoiceState] = useState<CustomerVoiceState>(() =>
    customerVoiceManager.getState(),
  );

  useEffect(() => {
    return customerVoiceManager.subscribe((next) => setVoiceState(next));
  }, []);

  if (!voiceState.browserSupported) return null;

  const needsEnableTap = !voiceState.enabled || !voiceState.audioUnlocked || voiceState.autoplayBlocked;

  const handleEnableClick = async () => {
    await customerVoiceManager.unlockOnUserGesture(true);
  };

  const handleToggleMute = () => {
    if (voiceState.enabled) {
      customerVoiceManager.setEnabled(false);
    } else {
      void customerVoiceManager.unlockOnUserGesture(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border transition-colors print:hidden ${
        voiceState.autoplayBlocked || voiceState.lastError
          ? 'bg-amber-50 border-amber-300 text-amber-950'
          : voiceState.isSpeaking
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : voiceState.audioUnlocked && voiceState.enabled
              ? 'bg-white border-neutral-200 text-neutral-900'
              : 'bg-[#151110] border-neutral-800 text-white'
      } ${compact ? 'px-4 py-3' : 'px-4 py-3.5 sm:px-5'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              voiceState.isSpeaking
                ? 'bg-emerald-700 text-white animate-pulse'
                : voiceState.autoplayBlocked || voiceState.lastError
                  ? 'bg-amber-600 text-white'
                  : voiceState.audioUnlocked && voiceState.enabled
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-[#E5391B] text-white'
            }`}
          >
            {voiceState.enabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </div>

          <div className="min-w-0">
            {voiceState.isSpeaking ? (
              <>
                <p className="text-xs font-extrabold text-emerald-800 uppercase tracking-wider">
                  Speaking · {voiceState.currentEventLabel || 'Order Update'}
                </p>
                <p className="text-xs text-emerald-950 font-medium line-clamp-2 mt-0.5">
                  &ldquo;{voiceState.currentText}&rdquo;
                </p>
              </>
            ) : voiceState.autoplayBlocked || voiceState.lastError ? (
              <>
                <p className="text-xs sm:text-sm font-extrabold">
                  {voiceState.lastError || 'Tap here to enable order voice updates.'}
                </p>
                <p className="text-[11px] opacity-80">
                  Hear live voice announcements for confirmed, preparing, ready &amp; payment status.
                </p>
              </>
            ) : voiceState.audioUnlocked && voiceState.enabled ? (
              <>
                <p className="text-xs sm:text-sm font-extrabold text-emerald-800 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Voice Updates Enabled
                </p>
                <p className="text-[11px] text-neutral-500">
                  {voiceState.lastSpokenText
                    ? `Last update: "${voiceState.lastSpokenText.slice(0, 72)}${voiceState.lastSpokenText.length > 72 ? '…' : ''}"`
                    : 'You will hear live updates automatically as your order progresses.'}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs sm:text-sm font-extrabold">
                  Live Order Voice Announcements
                </p>
                <p className="text-[11px] text-neutral-300">
                  Tap once to hear real-time voice alerts for kitchen &amp; payment updates.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {needsEnableTap ? (
            <button
              type="button"
              onClick={handleEnableClick}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E5391B] hover:bg-[#C82E14] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Volume2 className="w-4 h-4" />
              {voiceState.autoplayBlocked
                ? 'Tap to Enable Voice Updates'
                : 'Enable Voice Updates'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleToggleMute}
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <VolumeX className="w-3.5 h-3.5" />
              Mute
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
