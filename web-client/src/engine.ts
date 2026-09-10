import * as THREE from 'three';
import { GameState, TokenState } from './wasmLoader';
import { getTile3DPosition } from './boardCoordinates';
import { sounds } from './soundEffects';

export class Ludo3DEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private pawnMeshes: Map<number, THREE.Mesh> = new Map();
  private pawnTargetPositions: Map<number, THREE.Vector3> = new Map();
  private highlightRings: THREE.Mesh[] = [];
  private diceMesh!: THREE.Mesh;
  private isDiceRolling = false;
  private diceTargetRotation = new THREE.Euler();

  private onTokenClickedCallback?: (tokenId: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.02);

    // 2. Camera (Isometric Top-Angled View)
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 16, 14);
    this.camera.lookAt(0, 0, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 4. Lighting
    this.setupLighting();

    // 5. Build 3D Objects
    this.buildBoard();
    this.buildDice();

    // 6. Event Listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));

    // 7. Start Render Loop
    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(12, 20, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    this.scene.add(dirLight);

    // Subtle colored point lights for ambiance
    const redLight = new THREE.PointLight(0xef4444, 0.8, 15);
    redLight.position.set(-6, 3, -6);
    this.scene.add(redLight);

    const blueLight = new THREE.PointLight(0x3b82f6, 0.8, 15);
    blueLight.position.set(6, 3, 6);
    this.scene.add(blueLight);
  }

  private buildBoard(): void {
    const textureLoader = new THREE.TextureLoader();
    const baseColorTex = textureLoader.load('/assets/textures/board_basecolor.png');
    const normalTex = textureLoader.load('/assets/textures/board_normal.png');
    const roughnessTex = textureLoader.load('/assets/textures/board_roughness.png');

    const boardGeo = new THREE.BoxGeometry(15, 0.5, 15);
    const boardMat = new THREE.MeshStandardMaterial({
      map: baseColorTex,
      normalMap: normalTex,
      roughnessMap: roughnessTex,
      roughness: 0.35,
      metalness: 0.1
    });

    const boardMesh = new THREE.Mesh(boardGeo, boardMat);
    boardMesh.position.set(0, 0, 0);
    boardMesh.receiveShadow = true;
    this.scene.add(boardMesh);

    // Board Border Rim
    const rimGeo = new THREE.BoxGeometry(15.6, 0.6, 15.6);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.set(0, -0.1, 0);
    this.scene.add(rimMesh);
  }

  private buildDice(): void {
    const diceGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    
    // Procedural Dice Face Materials
    const materials: THREE.MeshStandardMaterial[] = [];
    for (let i = 1; i <= 6; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 128, 128);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(4, 4, 120, 120);

      // Draw Dots
      ctx.fillStyle = '#0f172a';
      const drawDot = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
      };

      const c = 64;
      const l = 32;
      const r = 96;

      if (i === 1) drawDot(c, c);
      if (i === 2) { drawDot(l, l); drawDot(r, r); }
      if (i === 3) { drawDot(l, l); drawDot(c, c); drawDot(r, r); }
      if (i === 4) { drawDot(l, l); drawDot(r, l); drawDot(l, r); drawDot(r, r); }
      if (i === 5) { drawDot(l, l); drawDot(r, l); drawDot(c, c); drawDot(l, r); drawDot(r, r); }
      if (i === 6) { drawDot(l, l); drawDot(r, l); drawDot(l, c); drawDot(r, c); drawDot(l, r); drawDot(r, r); }

      const tex = new THREE.CanvasTexture(canvas);
      materials.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2 }));
    }

    this.diceMesh = new THREE.Mesh(diceGeo, materials);
    this.diceMesh.position.set(0, 1.0, 0);
    this.diceMesh.castShadow = true;
    this.scene.add(this.diceMesh);
  }

  public triggerDiceAnimation(rollValue: number): void {
    if (rollValue === 0) return;
    this.isDiceRolling = true;
    sounds.playDiceRoll();

    // Set rotation target depending on face value
    const faceRotations: { [key: number]: { x: number; z: number } } = {
      1: { x: 0, z: -Math.PI / 2 },
      2: { x: 0, z: Math.PI / 2 },
      3: { x: Math.PI / 2, z: 0 },
      4: { x: -Math.PI / 2, z: 0 },
      5: { x: 0, z: 0 },
      6: { x: Math.PI, z: 0 }
    };

    const target = faceRotations[rollValue] || { x: 0, z: 0 };
    const extraSpins = Math.PI * 4;

    this.diceTargetRotation.set(
      target.x + extraSpins,
      target.z + extraSpins,
      0
    );

    setTimeout(() => {
      this.isDiceRolling = false;
      this.diceMesh.rotation.set(target.x, target.z, 0);
    }, 600);
  }

  public updateState(state: GameState, validTokenIds: number[]): void {
    const colorHexMap: { [key: string]: number } = {
      Red: 0xef4444,
      Green: 0x22c55e,
      Yellow: 0xeab308,
      Blue: 0x3b82f6
    };

    state.tokens.forEach((token) => {
      let mesh = this.pawnMeshes.get(token.id);

      if (!mesh) {
        // Create Pawn Mesh
        const pawnGeo = new THREE.CylinderGeometry(0.32, 0.45, 1.0, 24);
        const pawnMat = new THREE.MeshStandardMaterial({
          color: colorHexMap[token.color] || 0xffffff,
          roughness: 0.25,
          metalness: 0.2
        });

        mesh = new THREE.Mesh(pawnGeo, pawnMat);
        mesh.castShadow = true;
        mesh.userData = { tokenId: token.id };

        // Top Cap Spherical Head
        const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
        const headMesh = new THREE.Mesh(headGeo, pawnMat);
        headMesh.position.y = 0.55;
        headMesh.castShadow = true;
        mesh.add(headMesh);

        this.scene.add(mesh);
        this.pawnMeshes.set(token.id, mesh);
      }

      // Calculate Target 3D Position
      const colorIdx = Math.floor(state.tokens.indexOf(token) / 4);
      const p3d = getTile3DPosition(token.position, token.id, colorIdx);
      const targetVec = new THREE.Vector3(p3d.x, p3d.y, p3d.z);

      const currentTarget = this.pawnTargetPositions.get(token.id);
      if (currentTarget && !currentTarget.equals(targetVec)) {
        sounds.playStep();
      }

      this.pawnTargetPositions.set(token.id, targetVec);
    });

    // Update Valid Moves Glow Highlight Rings
    this.updateHighlightRings(validTokenIds);
  }

  private updateHighlightRings(validTokenIds: number[]): void {
    // Remove existing rings
    this.highlightRings.forEach(ring => this.scene.remove(ring));
    this.highlightRings = [];

    const ringGeo = new THREE.RingGeometry(0.5, 0.7, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });

    validTokenIds.forEach(id => {
      const targetPos = this.pawnTargetPositions.get(id);
      if (targetPos) {
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(targetPos.x, 0.35, targetPos.z);
        this.scene.add(ring);
        this.highlightRings.push(ring);
      }
    });
  }

  public setOnTokenClicked(callback: (tokenId: number) => void): void {
    this.onTokenClickedCallback = callback;
  }

  private onPointerDown(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(Array.from(this.pawnMeshes.values()), true);

    if (intersects.length > 0) {
      let object: THREE.Object3D | null = intersects[0].object;
      while (object && object.userData.tokenId === undefined && object.parent) {
        object = object.parent;
      }
      if (object && object.userData.tokenId !== undefined) {
        const tokenId = object.userData.tokenId as number;
        if (this.onTokenClickedCallback) {
          this.onTokenClickedCallback(tokenId);
        }
      }
    }
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    // Smooth Lerp Pawn Movement
    this.pawnMeshes.forEach((mesh, id) => {
      const target = this.pawnTargetPositions.get(id);
      if (target) {
        mesh.position.lerp(target, 0.18);
      }
    });

    // Dice Spin Animation
    if (this.isDiceRolling && this.diceMesh) {
      this.diceMesh.rotation.x += 0.3;
      this.diceMesh.rotation.y += 0.3;
    }

    // Pulse Highlight Rings
    this.highlightRings.forEach(ring => {
      ring.rotation.z += 0.03;
    });

    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize(): void {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
