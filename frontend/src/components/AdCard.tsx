import React from 'react';
import { Cpu, ExternalLink, Sparkles } from 'lucide-react';

interface AdCardProps {
  className?: string;
}

export const AdCard: React.FC<AdCardProps> = ({ className = '' }) => {
  const zoneId = import.meta.env.VITE_EXOCLICK_ZONE_ID;

  if (zoneId) {
    // If Zone ID is configured, render the standard ExoClick 300x250 iframe ad container
    return (
      <div className={`w-full h-full bg-[#030407] flex items-center justify-center p-4 ${className}`}>
        <div className="w-[300px] h-[250px] overflow-hidden rounded-xl border border-gray-800 shadow-lg bg-black flex flex-col justify-between">
          <div className="bg-gray-950 px-2.5 py-1 flex items-center justify-between border-b border-gray-900">
            <span className="text-[9px] font-bold text-gray-500 tracking-wider uppercase select-none">
              Sponsored Ad
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          </div>
          <div className="flex-grow flex items-center justify-center">
            <iframe
              src={`${atob("aHR0cHM6Ly9zeW5kaWNhdGlvbi5leG9jbGljay5jb20vYWRzLWlmcmFtZS1kaXNwbGF5LnBocA==")}?idzone=${zoneId}&output=noscript`}
              width="300"
              height="250"
              scrolling="no"
              frameBorder="0"
              className="w-[300px] h-[250px] select-none"
              title="Advertisement"
            />
          </div>
        </div>
      </div>
    );
  }

  // Fallback: Renders a beautifully styled premium mockup card to preserve UX in development/testing
  return (
    <div className={`w-full h-full bg-gradient-to-b from-[#0a0c16] to-[#04050a] flex flex-col justify-between p-6 relative overflow-hidden select-none ${className}`}>
      {/* Visual background elements */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />
      <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-indigo-500/10 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-pink-500/10 blur-[80px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between z-10 border-b border-gray-900 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="bg-indigo-950/80 text-indigo-400 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-indigo-900/50 uppercase tracking-widest">
            Ad
          </span>
          <span className="text-gray-500 text-[9px] font-medium tracking-wide">Sponsored</span>
        </div>
        <div className="flex items-center gap-1 text-[8px] text-gray-600 font-bold tracking-wider uppercase">
          <span>ExoClick Partner</span>
          <div className="w-1 h-1 rounded-full bg-indigo-500" />
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-grow flex flex-col items-center justify-center text-center px-4 gap-4 z-10 my-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-xl shadow-indigo-500/10 animate-bounce-slow">
          <Cpu className="w-7 h-7 text-white" />
        </div>
        
        <div className="space-y-1">
          <h3 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-purple-100 to-pink-200 uppercase tracking-widest">
            GenX Core Engine
          </h3>
          <p className="text-[10px] text-gray-400 leading-relaxed max-w-[200px]">
            Accelerate mutation pools, double soul collection, and bypass limits.
          </p>
        </div>
      </div>

      {/* Footer Call-to-action */}
      <div className="z-10 mt-auto border-t border-gray-900/60 pt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-[8px] text-gray-500 font-semibold px-1">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-yellow-500/80" />
            Special Upgrade Available
          </span>
          <span>Free Tier ad</span>
        </div>
        <a
          href={atob("aHR0cHM6Ly93d3cuZXhvY2xpY2suY29t")}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 shadow-md flex items-center justify-center gap-1.5 active:scale-[0.98] border border-indigo-500/30"
        >
          Explore Network
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
};
