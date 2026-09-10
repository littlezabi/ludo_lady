import * as THREE from 'three';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

// 15x15 Ludo Board Grid Cell Size (Board width = 14.8 units)
const CELL_SIZE = 14.8 / 15.0; // 0.986667

function cellTo3D(col: number, row: number, yPos = 0.65): Point3D {
  return {
    x: -7.4 + (col + 0.5) * CELL_SIZE,
    y: yPos,
    z: -7.4 + (row + 0.5) * CELL_SIZE
  };
}

export function getTile3DPosition(positionCode: number, tokenId: number, colorIdx: number): Point3D {
  const yPos = 0.65;

  // 1. Home Base Positions (-1) - Preserving exact user coordinates
  if (positionCode === -1) {
    const baseOffset = tokenId % 4;
    const offsets = [
      { x: -1.2, z: -1.2 },
      { x: 1.2, z: -1.2 },
      { x: -1.2, z: 1.2 },
      { x: 1.2, z: 1.2 }
    ];

    const corners = [
      { cx: -4.45, cz: -4.45 },  // Red (0) - Top-Left
      { cx: 4.45, cz: -4.45 },   // Green (1) - Top-Right
      { cx: 4.45, cz: 4.45 },    // Yellow (2) - Bottom-Right
      { cx: -4.45, cz: 4.45 }    // Blue (3) - Bottom-Left
    ];

    const safeColorIdx = Math.floor(Math.abs(colorIdx)) % 4;
    const corner = corners[safeColorIdx] || corners[0];
    const off = offsets[baseOffset] || offsets[0];
    return {
      x: corner.cx + off.x,
      y: yPos,
      z: corner.cz + off.z
    };
  }

  // 2. Finished Center Positions (999)
  if (positionCode === 999) {
    const centerOffsets = [
      { x: -0.8, z: -0.8 }, // Red
      { x: -0.8, z: 0.8 },  // Green
      { x: 0.8, z: 0.8 },   // Yellow
      { x: 0.8, z: -0.8 }    // Blue
    ];
    const safeColorIdx = Math.floor(Math.abs(colorIdx)) % 4;
    const co = centerOffsets[safeColorIdx] || centerOffsets[0];
    return { x: co.x, y: yPos + 0.3, z: co.z };
  }

  // 3. Home Stretch Positions (100..105, 200..205, 300..305, 400..405)
  if (positionCode >= 100) {
    const colorType = Math.floor(positionCode / 100);
    const step = (positionCode % 100) + 1; // 1 to 5 steps

    switch (colorType) {
      case 1: // Red Stretch (moving right from col 1 to 5, row 7)
        return cellTo3D(step, 7, yPos);
      case 2: // Green Stretch (moving down from row 1 to 5, col 7)
        return cellTo3D(7, step, yPos);
      case 3: // Yellow Stretch (moving left from col 13 to 9, row 7)
        return cellTo3D(14 - step, 7, yPos);
      case 4: // Blue Stretch (moving up from row 13 to 9, col 7)
        return cellTo3D(7, 14 - step, yPos);
    }
  }

  // 4. Main 52 Track Tiles (0 to 51 mapped to exact 15x15 grid cells)
  const trackGrid: [number, number][] = [
    // Red Arm -> Top Arm (0..12)
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0], [8, 0],

    // Green Arm -> Right Arm (13..25)
    [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7], [14, 8],

    // Yellow Arm -> Bottom Arm (26..38)
    [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14], [6, 14],

    // Blue Arm -> Left Arm (39..51)
    [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7], [0, 6]
  ];

  const idx = Math.max(0, Math.min(51, positionCode));
  const [col, row] = trackGrid[idx] || [7, 7];

  return cellTo3D(col, row, yPos);
}
