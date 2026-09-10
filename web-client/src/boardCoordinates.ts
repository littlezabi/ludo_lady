import * as THREE from 'three';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Board width: 14 units (-7 to +7)
const GRID_SCALE = 0.92;

export function getTile3DPosition(positionCode: number, tokenId: number, colorIdx: number): Point3D {
  // Height offset for pawns on board
  const yPos = 0.65;

  // 1. Home Base Positions (-1)
  if (positionCode === -1) {
    const baseOffset = tokenId % 4;
    const offsets = [
      { x: -1.2, z: -1.2 },
      { x: 1.2, z: -1.2 },
      { x: -1.2, z: 1.2 },
      { x: 1.2, z: 1.2 }
    ];

    const corners = [
      { cx: -4.8, cz: -4.8 },  // Red (0) - Top-Left
      { cx: 4.8, cz: -4.8 },   // Green (1) - Top-Right
      { cx: 4.8, cz: 4.8 },    // Yellow (2) - Bottom-Right
      { cx: -4.8, cz: 4.8 }    // Blue (3) - Bottom-Left
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

  // 2. Finished Positions (999)
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
    const step = (positionCode % 100) + 1; // 1 to 6

    switch (colorType) {
      case 1: // Red Stretch (moving right towards center)
        return { x: (-6.5 + step * GRID_SCALE), y: yPos, z: 0 };
      case 2: // Green Stretch (moving down towards center)
        return { x: 0, y: yPos, z: (-6.5 + step * GRID_SCALE) };
      case 3: // Yellow Stretch (moving left towards center)
        return { x: (6.5 - step * GRID_SCALE), y: yPos, z: 0 };
      case 4: // Blue Stretch (moving up towards center)
        return { x: 0, y: yPos, z: (6.5 - step * GRID_SCALE) };
    }
  }

  // 4. Main 52 Track Tiles (0 to 51)
  // Mapping 52 outer track tiles clockwise
  const trackCoords: { x: number; z: number }[] = [];

  // Red Arm (0..12)
  for (let i = 0; i < 6; i++) trackCoords.push({ x: -5.5 + i * GRID_SCALE, z: -1.2 }); // 0..5
  for (let i = 0; i < 6; i++) trackCoords.push({ x: -1.2, z: -1.8 - i * GRID_SCALE }); // 6..11
  trackCoords.push({ x: 0, z: -6.5 }); // 12

  // Green Arm (13..25)
  for (let i = 0; i < 6; i++) trackCoords.push({ x: 1.2, z: -6.5 + i * GRID_SCALE }); // 13..18
  for (let i = 0; i < 6; i++) trackCoords.push({ x: 1.8 + i * GRID_SCALE, z: -1.2 }); // 19..24
  trackCoords.push({ x: 6.5, z: 0 }); // 25

  // Yellow Arm (26..38)
  for (let i = 0; i < 6; i++) trackCoords.push({ x: 6.5 - i * GRID_SCALE, z: 1.2 }); // 26..31
  for (let i = 0; i < 6; i++) trackCoords.push({ x: 1.2, z: 1.8 + i * GRID_SCALE }); // 32..37
  trackCoords.push({ x: 0, z: 6.5 }); // 38

  // Blue Arm (39..51)
  for (let i = 0; i < 6; i++) trackCoords.push({ x: -1.2, z: 6.5 - i * GRID_SCALE }); // 39..44
  for (let i = 0; i < 6; i++) trackCoords.push({ x: -1.8 - i * GRID_SCALE, z: 1.2 }); // 45..50
  trackCoords.push({ x: -6.5, z: 0 }); // 51

  const idx = Math.max(0, Math.min(51, positionCode));
  const coord = trackCoords[idx] || { x: 0, z: 0 };
  return { x: coord.x, y: yPos, z: coord.z };
}
