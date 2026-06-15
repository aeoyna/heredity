import React, { useRef, useEffect } from 'react';
import type { LineDNA } from '../../../backend/src/shared-types';

interface LineCanvasProps {
  dna: LineDNA;
  className?: string;
}

export const LineCanvas: React.FC<LineCanvasProps> = ({ dna, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!Array.isArray(dna)) {
      console.warn('LineCanvas expected Array DNA but got:', typeof dna);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get resolution
    const width = canvas.width;
    const height = canvas.height;

    // Clear background to white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Set line settings
    ctx.lineCap = 'round';

    // Draw the 10 lines
    dna.forEach(gene => {
      ctx.beginPath();
      
      // Map normalized coordinates (0.0 - 1.0) to actual canvas size
      const sx = gene.sx * width;
      const sy = gene.sy * height;
      const cp1x = gene.cp1x * width;
      const cp1y = gene.cp1y * height;
      const cp2x = gene.cp2x * width;
      const cp2y = gene.cp2y * height;
      const ex = gene.ex * width;
      const ey = gene.ey * height;
      
      // Calculate scaled line width (scaled relative to canvas width, e.g. max 12px)
      ctx.lineWidth = gene.width * 10;
      ctx.strokeStyle = gene.color;

      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
      ctx.stroke();
    });
  }, [dna]);

  return (
    <canvas 
      ref={canvasRef}
      width={400}
      height={400}
      className={`w-full h-full transition-all duration-300 ${className}`}
    />
  );
};
