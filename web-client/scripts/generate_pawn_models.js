import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import * as fs from 'fs';
import * as path from 'path';

function buildHollowPawnGeometry() {
  const points = [];

  // 1. Inner Hollow Cavity (Ceiling down to Bottom Rim)
  points.push(new THREE.Vector2(0.00, 0.58)); // Cavity ceiling
  points.push(new THREE.Vector2(0.20, 0.52)); // Upper cavity wall
  points.push(new THREE.Vector2(0.30, 0.24)); // Mid cavity wall
  points.push(new THREE.Vector2(0.36, 0.08)); // Lower cavity wall
  points.push(new THREE.Vector2(0.40, 0.00)); // Inner rim

  // 2. Outer Base & Exposed Color Ring
  points.push(new THREE.Vector2(0.48, 0.00)); // Outer bottom corner
  points.push(new THREE.Vector2(0.48, 0.06)); // Base vertical lip
  points.push(new THREE.Vector2(0.44, 0.12)); // Base bevel
  points.push(new THREE.Vector2(0.42, 0.18)); // Exposed color ring
  points.push(new THREE.Vector2(0.35, 0.22)); // Nesting shoulder step (stopping ledge)

  // 3. Tapered Body & Collar Ring
  points.push(new THREE.Vector2(0.30, 0.35)); // Waist
  points.push(new THREE.Vector2(0.35, 0.44)); // Upper collar
  points.push(new THREE.Vector2(0.22, 0.56)); // Neck

  // 4. Spherical Head
  points.push(new THREE.Vector2(0.28, 0.68));
  points.push(new THREE.Vector2(0.30, 0.76)); // Head equator
  points.push(new THREE.Vector2(0.20, 0.86));
  points.push(new THREE.Vector2(0.00, 0.88)); // Head top

  const latheGeo = new THREE.LatheGeometry(points, 32);
  latheGeo.computeVertexNormals();
  return latheGeo;
}

function generateObjAndMtl() {
  const outDir = path.resolve('public/assets/models');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const geometry = buildHollowPawnGeometry();
  const exporter = new OBJExporter();

  const colors = [
    { name: 'red', hex: '#ef4444', rgb: [0.937, 0.267, 0.267] },
    { name: 'green', hex: '#22c55e', rgb: [0.133, 0.773, 0.369] },
    { name: 'blue', hex: '#3b82f6', rgb: [0.231, 0.510, 0.965] },
    { name: 'yellow', hex: '#eab308', rgb: [0.918, 0.702, 0.031] }
  ];

  colors.forEach(col => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col.hex),
      roughness: 0.5,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `Ludo_Pawn_${col.name}`;

    const objContent = exporter.parse(mesh);

    const mtlContent = `# Ludo Pawn Material - ${col.name.toUpperCase()}
newmtl Material_${col.name.charAt(0).toUpperCase() + col.name.slice(1)}
Ns 250.0000
Ka 1.0000 1.0000 1.0000
Kd ${col.rgb[0].toFixed(4)} ${col.rgb[1].toFixed(4)} ${col.rgb[2].toFixed(4)}
Ks 0.5000 0.5000 0.5000
Ni 1.4500
d 1.0000
illum 2
`;

    const objPath = path.join(outDir, `ludo_piece_${col.name}.obj`);
    const mtlPath = path.join(outDir, `ludo_piece_${col.name}.mtl`);

    fs.writeFileSync(objPath, `mtllib ludo_piece_${col.name}.mtl\n` + objContent);
    fs.writeFileSync(mtlPath, mtlContent);

    console.log(`Generated: ${objPath} & ${mtlPath}`);
  });
}

generateObjAndMtl();
