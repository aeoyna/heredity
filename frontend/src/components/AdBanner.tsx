import React from 'react';
import { Download, Sparkles } from 'lucide-react';

interface AdBannerProps {
  country: string;
  lang?: 'ja' | 'en';
  onInstallClick: () => void;
}

export const AdBanner: React.FC<AdBannerProps> = ({ lang, onInstallClick }) => {
  return (
    <button
      onClick={onInstallClick}
      className="w-full max-w-[380px] h-[50px] flex items-center justify-between px-4 bg-gradient-to-r from-gray-950 via-purple-950/30 to-gray-950 border border-purple-500/20 hover:border-purple-500/40 rounded-xl relative overflow-hidden group active:scale-[0.98] transition-all text-left shadow-lg shadow-purple-950/20"
    >
      {/* Background glowing ambient light */}
      <div className="absolute -inset-px bg-gradient-to-r from-purple-500/15 to-indigo-500/15 rounded-xl blur opacity-40 group-hover:opacity-60 transition-opacity duration-500" />
      
      <div className="flex items-center gap-3 z-10 min-w-0">
        {/* Glow badge */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-600/30">
          <Sparkles className="w-3.5 h-3.5 text-white animate-pulse" />
        </div>
        
        <div className="min-w-0">
          <h4 className="text-[10px] font-black text-gray-200 tracking-wider uppercase flex items-center gap-1.5 leading-none">
            <span>{lang === 'en' ? 'ADD TO HOME SCREEN' : 'ホーム画面にアプリを追加'}</span>
            <span className="text-[7.5px] px-1 py-0.2 bg-purple-500/20 border border-purple-500/30 rounded text-purple-400 font-bold uppercase tracking-wider">PWA</span>
          </h4>
          <p className="text-[8px] text-gray-400 truncate mt-1">
            {lang === 'en'
              ? 'Play gene46 full-screen like a native app!'
              : 'ネイティブアプリのように全画面で快適にプレイ！'}
          </p>
        </div>
      </div>
      
      {/* Install Button Trigger indicator */}
      <div className="z-10 px-2 py-1 bg-gray-900 border border-gray-800 rounded-lg text-[8px] font-extrabold text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-transparent transition-all flex items-center gap-1">
        <Download className="w-2.5 h-2.5" />
        <span>INSTALL</span>
      </div>
    </button>
  );
};
