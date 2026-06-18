import React, { useRef, useEffect } from 'react';
import { ShieldAlert, Zap } from 'lucide-react';

interface NoiseCardProps {
  className?: string;
}

export const NoiseCard: React.FC<NoiseCardProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const render = () => {
      // Generate randomized grayscale noise pixels
      for (let i = 0; i < data.length; i += 4) {
        const val = Math.random() > 0.5 ? 240 : 15; // High contrast retro static noise
        data[i] = val;       // R
        data[i + 1] = val;   // G
        data[i + 2] = val;   // B
        data[i + 3] = 255;   // A
      }
      ctx.putImageData(imgData, 0, 0);
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div className={`w-full h-full bg-[#07080d] flex flex-col justify-between p-6 relative overflow-hidden select-none ${className}`}>
      {/* Background static noise canvas */}
      <div className="absolute inset-0 opacity-15 pointer-events-none mix-blend-screen">
        <canvas
          ref={canvasRef}
          width={128}
          height={128}
          className="w-full h-full object-cover pixelated"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Grid Overlay for cybernetic screen aesthetic */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-purple-500/5 blur-[60px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[60px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between z-10 border-b border-gray-900/60 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="bg-purple-950/70 text-purple-400 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-purple-900/30 uppercase tracking-widest">
            Glitch
          </span>
          <span className="text-gray-500 text-[9px] font-bold tracking-wide">Specimen Noise</span>
        </div>
        <div className="flex items-center gap-1 text-[8px] text-gray-600 font-bold tracking-wider uppercase">
          <span>Signal Intercepted</span>
          <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping" />
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-grow flex flex-col items-center justify-center text-center px-4 gap-4.5 z-10 my-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-950/50 to-indigo-950/50 border border-purple-800/20 flex items-center justify-center shadow-lg relative overflow-hidden">
            {/* Animated glitch scanner line */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-purple-500/60 shadow-[0_0_8px_#a855f7] animate-pulse" 
                 style={{
                   animation: 'scan 2s linear infinite',
                   transform: 'translateY(0)'
                 }}
            />
            <ShieldAlert className="w-7 h-7 text-purple-400/90" />
          </div>
        </div>
        
        <div className="space-y-1.5">
          <h3 className="text-xs font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-purple-100 to-indigo-300 uppercase tracking-widest">
            MUTATION NOISE
          </h3>
          <p className="text-[9.5px] text-gray-500 leading-relaxed max-w-[220px]">
            This specimen is corrupted by evolutionary static. Swipe left (Nope) or right (Like) to pass through.
          </p>
        </div>
      </div>

      {/* Footer Call-to-action */}
      <div className="z-10 mt-auto border-t border-gray-900/40 pt-4 flex flex-col gap-2">
        <div className="flex items-center justify-center text-[8px] text-gray-600 font-bold px-1 gap-1.5 uppercase tracking-wider">
          <Zap className="w-3 h-3 text-purple-500/80" />
          <span>Bypass by purchasing AdFree Pass in Shop</span>
        </div>
      </div>

      {/* Inject custom CSS keyframes for scan line */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}</style>
    </div>
  );
};
