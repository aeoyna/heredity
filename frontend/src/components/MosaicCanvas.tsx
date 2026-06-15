import React, { useRef, useEffect } from 'react';
import type { MosaicDNA } from '../../../backend/src/shared-types';

interface MosaicCanvasProps {
  dna: MosaicDNA;
  className?: string;
}

export const MosaicCanvas: React.FC<MosaicCanvasProps> = ({ dna, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!dna) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Check if it's a honeypot (represented by an empty array)
    if (dna.length === 0) {
      // Render sandstorm/noise pattern
      const imgData = ctx.createImageData(128, 128);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const val = Math.random() > 0.5 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      return;
    }

    // CPPN Rendering: 128x128 pixels
    const imgData = ctx.createImageData(128, 128);
    const data = imgData.data;

    // Pre-allocated array for node outputs (4 inputs + 30 nodes = 34 floats)
    const outputs = new Float32Array(4 + dna.length);

    for (let py = 0; py < 128; py++) {
      const y = py / 63.5 - 1.0;
      for (let px = 0; px < 128; px++) {
        const x = px / 63.5 - 1.0;
        const d = Math.sqrt(x * x + y * y);

        // Set inputs: 0: x, 1: y, 2: d, 3: bias
        outputs[0] = x;
        outputs[1] = y;
        outputs[2] = d;
        outputs[3] = 1.0;

        // Evaluate nodes sequentially (DAG execution)
        for (let i = 0; i < dna.length; i++) {
          const node = dna[i];
          const val1 = outputs[node.in1];
          const val2 = outputs[node.in2];
          const sum = val1 * node.w1 + val2 * node.w2;

          let out = sum;
          switch (node.fn) {
            case 0: out = Math.sin(sum); break;
            case 1: out = Math.cos(sum); break;
            case 2: out = Math.tanh(sum); break;
            case 3: out = Math.abs(sum); break;
            case 4: out = sum * sum; break;
            case 5: out = Math.exp(-sum * sum); break;
            case 6: out = sum > 0 ? 1.0 : -1.0; break;
            case 7: out = Math.max(-1.0, Math.min(1.0, sum)); break;
          }
          outputs[4 + i] = out;
        }

        // Extract RGB from the outputs of the last 3 nodes
        const outR = outputs[outputs.length - 3];
        const outG = outputs[outputs.length - 2];
        const outB = outputs[outputs.length - 1];

        // Map [-1.0, 1.0] to [0, 255]
        const r = Math.floor(Math.max(-1.0, Math.min(1.0, outR)) * 127.5 + 127.5);
        const g = Math.floor(Math.max(-1.0, Math.min(1.0, outG)) * 127.5 + 127.5);
        const b = Math.floor(Math.max(-1.0, Math.min(1.0, outB)) * 127.5 + 127.5);

        const pIdx = (py * 128 + px) * 4;
        data[pIdx] = r;
        data[pIdx + 1] = g;
        data[pIdx + 2] = b;
        data[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [dna]);

  return (
    <canvas 
      ref={canvasRef}
      width={128}
      height={128}
      style={{ imageRendering: 'pixelated' }}
      className={`w-full h-full transition-all duration-300 ${className}`}
    />
  );
};
