// Shared DNA definitions for Project-X

export interface LineGene {
  sx: number;     // Start X (0.0 to 1.0)
  sy: number;     // Start Y (0.0 to 1.0)
  cp1x: number;   // Control Point 1 X (0.0 to 1.0)
  cp1y: number;   // Control Point 1 Y (0.0 to 1.0)
  cp2x: number;   // Control Point 2 X (0.0 to 1.0)
  cp2y: number;   // Control Point 2 Y (0.0 to 1.0)
  ex: number;     // End X (0.0 to 1.0)
  ey: number;     // End Y (0.0 to 1.0)
  width: number;  // Stroke width (0.0 to 1.0)
  color: string;  // Hex color code (e.g. #ff00ff)
}

export type LineDNA = LineGene[];

// Cartesian Genetic Programming (CGP) / CPPN Node definition
export interface CGPNode {
  in1: number; // Input 1 index (0..3: inputs, 4..: previous nodes)
  in2: number; // Input 2 index
  w1: number;  // Weight for input 1 (-2.0 to 2.0)
  w2: number;  // Weight for input 2 (-2.0 to 2.0)
  fn: number;  // Function index (0..7)
}

export type MosaicDNA = CGPNode[]; // Array of nodes (e.g., 30 nodes)

export const NUM_CGP_NODES = 30;

// Generates random color (Hex format)
export function randomHexColor(grayscale = false): string {
  if (grayscale) {
    const v = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }
  const r = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  const g = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  const b = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomLineDNA(): LineDNA {
  const dna: LineDNA = [];
  for (let i = 0; i < 10; i++) {
    dna.push({
      sx: Math.random(),
      sy: Math.random(),
      cp1x: Math.random(),
      cp1y: Math.random(),
      cp2x: Math.random(),
      cp2y: Math.random(),
      ex: Math.random(),
      ey: Math.random(),
      width: Math.random() * 0.8 + 0.2, // normal width range
      color: '#000000' // Black lines
    });
  }
  return dna;
}

export function generateRandomMosaicDNA(): MosaicDNA {
  const dna: MosaicDNA = [];
  for (let i = 0; i < NUM_CGP_NODES; i++) {
    // Node i can connect to any of the 4 inputs (0..3) or outputs of previous nodes (4..4+i-1)
    const maxInputIndex = 4 + i;
    dna.push({
      in1: Math.floor(Math.random() * maxInputIndex),
      in2: Math.floor(Math.random() * maxInputIndex),
      w1: Math.random() * 4.0 - 2.0, // -2.0 to 2.0
      w2: Math.random() * 4.0 - 2.0, // -2.0 to 2.0
      fn: Math.floor(Math.random() * 8) // 0 to 7 functions
    });
  }
  return dna;
}

export function generateHoneypotLineDNA(): LineDNA {
  // A honeypot line card is super boring: flat lines or completely uniform zero length
  const dna: LineDNA = [];
  for (let i = 0; i < 10; i++) {
    dna.push({
      sx: 0.1,
      sy: 0.9,
      cp1x: 0.1,
      cp1y: 0.9,
      cp2x: 0.9,
      cp2y: 0.9,
      ex: 0.9,
      ey: 0.9,
      width: 0.1,
      color: '#888888' // Dull gray flat lines
    });
  }
  return dna;
}

export function generateHoneypotMosaicDNA(): MosaicDNA {
  // A honeypot mosaic card is represented by an empty array (length 0).
  // The client will render an empty array as high-frequency sandstorm noise.
  return [];
}
