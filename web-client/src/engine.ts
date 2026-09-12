import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GameState, TokenState } from './wasmLoader';
import { getTile3DPosition, getStepByStepPath, getReverseStepByStepPath } from './boardCoordinates';
import { sounds } from './soundEffects';

export type CameraViewMode = 'free' | 'top' | 'home' | 'active_turn';

export class Ludo3DEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private pawnMeshes: Map<number, THREE.Mesh> = new Map();
  private pawnTargetPositions: Map<number, THREE.Vector3> = new Map();
  private pawnWaypoints: Map<number, THREE.Vector3[]> = new Map();
  private tokenPreviousSteps: Map<number, number> = new Map();
  private tokenPreviousPositions: Map<number, number> = new Map();
  private stackArrivalOrder: Map<number, number[]> = new Map();
  private currentPositionGroups: Map<number, number[]> = new Map();
  private capturedRewindTokens: Set<number> = new Set();
  private highlightRings: THREE.Mesh[] = [];
  private diceMesh!: THREE.Mesh;
  public isDiceRolling = false;
  private diceTargetRotation = new THREE.Euler();
  private stackIndicatorGroup = new THREE.Group();
  private dirLight!: THREE.DirectionalLight;

  public cameraViewMode: CameraViewMode = 'top';
  public myPlayerColor: number = 0; // 0: Red, 1: Green, 2: Yellow, 3: Blue
  private targetCameraPos = new THREE.Vector3(0, 16, 14);
  private targetCameraLookAt = new THREE.Vector3(0, 0, 0);
  private isTransitioningCamera = false;

  private pointerDownX = 0;
  private pointerDownY = 0;

  private onTokenClickedCallback?: (primaryTokenId: number, stackTokenIds: number[]) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    // Remove fog to prevent distance darkening/shadow gradients on board
    this.scene.fog = null;
    this.scene.add(this.stackIndicatorGroup);

    // 2. Camera (Isometric Top-Angled View)
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 22, 0.001);
    this.camera.lookAt(0, 0, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls (Mouse & Touch Orbit / Rotate / Pan / Zoom)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2.15; // Prevent camera going below floor
    this.controls.minDistance = 6;
    this.controls.maxDistance = 45;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const isFree = this.cameraViewMode === 'free';
    this.controls.enableRotate = isFree;
    this.controls.enablePan = isFree;
    this.controls.enableZoom = isFree;

    // Set responsive camera position based on screen aspect ratio
    this.updateCameraAspect();

    // 5. Lighting
    this.setupLighting();

    // 6. Build 3D Objects
    this.buildBoard();
    this.buildDice();

    // 7. Event Listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));

    // 7. Start Render Loop
    this.animate();
  }

  private setupLighting(): void {
    // 1. Clean Natural Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    // 2. Overhead Main Key Light (Soft shadows, wide bounds so shadow edge never clips board)
    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    this.dirLight.position.set(12, 25, 8);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.camera.left = -30;
    this.dirLight.shadow.camera.right = 30;
    this.dirLight.shadow.camera.top = 30;
    this.dirLight.shadow.camera.bottom = -30;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // 3. Front Fill Light (Ensures 100% of board front/bottom face is illuminated)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(0, 12, 18);
    this.scene.add(fillLight);
  }

  private buildBoard(): void {
    const textureLoader = new THREE.TextureLoader();
    const baseColorTex = textureLoader.load('/assets/textures/board_basecolor.png');
    const normalTex = textureLoader.load('/assets/textures/board_normal.png');
    const roughnessTex = textureLoader.load('/assets/textures/board_roughness.png');

    // 1. 3D Base Box (Table Frame)
    const baseGeo = new THREE.BoxGeometry(15.2, 0.5, 15.2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.1
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, 0, 0);
    baseMesh.receiveShadow = true;
    this.scene.add(baseMesh);

    // 2. Top Ludo Board Texture Surface Plane
    const topGeo = new THREE.PlaneGeometry(14.8, 14.8);
    const topMat = new THREE.MeshStandardMaterial({
      map: baseColorTex,
      normalMap: normalTex,
      roughnessMap: roughnessTex,
      roughness: 0.75,
      metalness: 0.0
    });

    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.rotation.x = -Math.PI / 2;
    topMesh.position.set(0, 0.26, 0);
    topMesh.receiveShadow = true;
    this.scene.add(topMesh);

    // 3. Beveled Outer Rim
    const rimGeo = new THREE.BoxGeometry(15.6, 0.6, 15.6);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.set(0, -0.1, 0);
    this.scene.add(rimMesh);
  }

  private buildDice(): void {
    // Reduced dice size from 1.2 to 0.80 for elegant, proportional 3D appearance
    const diceGeo = new THREE.BoxGeometry(0.80, 0.80, 0.80);
    
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
      ctx.fillStyle = i === 6 ? '#dc2626' : '#0f172a'; // Red dots for 6 face!
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
      materials.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 }));
    }

    this.diceMesh = new THREE.Mesh(diceGeo, materials);
    this.diceMesh.position.set(0, 0.66, 0); // Positioned cleanly on center floor surface (y = 0.26 + 0.40)
    this.diceMesh.castShadow = true;
    this.scene.add(this.diceMesh);
  }

  public triggerDiceAnimation(rollValue: number): void {
    if (rollValue === 0) return;
    this.isDiceRolling = true;
    sounds.playDiceRoll();

    // Set rotation target depending on face value (bringing face to +Y top)
    const faceRotations: { [key: number]: { x: number; y: number; z: number } } = {
      1: { x: 0, y: 0, z: Math.PI / 2 },
      2: { x: 0, y: 0, z: -Math.PI / 2 },
      3: { x: 0, y: 0, z: 0 },
      4: { x: Math.PI, y: 0, z: 0 },
      5: { x: -Math.PI / 2, y: 0, z: 0 },
      6: { x: Math.PI / 2, y: 0, z: 0 }
    };

    const target = faceRotations[rollValue] || { x: 0, y: 0, z: 0 };
    const extraSpins = Math.PI * 4;

    this.diceTargetRotation.set(
      target.x + extraSpins,
      target.y + extraSpins,
      target.z
    );

    setTimeout(() => {
      this.isDiceRolling = false;
      this.diceMesh.rotation.set(target.x, target.y, target.z);

      if (rollValue === 6) {
        this.triggerSixAnimation();
      }
    }, 500);
  }

  public triggerSixAnimation(): void {
    sounds.playWinFanfare();

    // 1. Emissive Gold Glow Pulse on Dice Mesh
    if (this.diceMesh && Array.isArray(this.diceMesh.material)) {
      this.diceMesh.material.forEach(mat => {
        if ('emissive' in mat) {
          (mat as THREE.MeshStandardMaterial).emissive.setHex(0xf59e0b);
          (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
        }
      });

      setTimeout(() => {
        if (this.diceMesh && Array.isArray(this.diceMesh.material)) {
          this.diceMesh.material.forEach(mat => {
            if ('emissive' in mat) {
              (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0;
            }
          });
        }
      }, 1600);
    }

    // 2. Floating Celebratory 6 Badge
    const overlayContainer = document.getElementById('emoji-overlay-container');
    if (!overlayContainer) return;

    const vector = new THREE.Vector3(0, 1.6, 0);
    vector.project(this.camera);

    const canvas = this.renderer.domElement;
    const widthHalf = canvas.clientWidth / 2;
    const heightHalf = canvas.clientHeight / 2;

    const screenX = (vector.x * widthHalf) + widthHalf;
    const screenY = -(vector.y * heightHalf) + heightHalf;

    const bubble = document.createElement('div');
    bubble.className = `dice-six-bubble`;
    bubble.style.left = `${screenX}px`;
    bubble.style.top = `${screenY}px`;

    bubble.innerHTML = `
      <div class="six-icon">✨ 6! ✨</div>
      <div class="six-label">BONUS ROLL</div>
    `;

    overlayContainer.appendChild(bubble);

    setTimeout(() => {
      bubble.remove();
    }, 1500);
  }

  public selectedDebugTokenId: number | null = null;
  private sharedPawnGeometry: THREE.BufferGeometry | null = null;
  private sharedBaseRingGeometry: THREE.BufferGeometry | null = null;

  private createHollowPawnGeometry(): THREE.BufferGeometry {
    if (this.sharedPawnGeometry) return this.sharedPawnGeometry;

    const points: THREE.Vector2[] = [];

    // 1. Solid Bottom Base Cap (Floor disc at y = 0.00)
    points.push(new THREE.Vector2(0.00, 0.00)); // Bottom center
    points.push(new THREE.Vector2(0.44, 0.00)); // Bottom outer edge

    // 2. Base Ring Lip & Vertical Cylinder
    points.push(new THREE.Vector2(0.45, 0.03)); // Base outer lip
    points.push(new THREE.Vector2(0.45, 0.16)); // Vertical base ring cylinder
    points.push(new THREE.Vector2(0.41, 0.20)); // Beveled top of base ring
    points.push(new THREE.Vector2(0.33, 0.22)); // Nesting shoulder step (stopping ledge)

    // 3. Smooth Conical Body & Neck Collar
    points.push(new THREE.Vector2(0.30, 0.28)); // Lower waist
    points.push(new THREE.Vector2(0.25, 0.55)); // Conical body taper
    points.push(new THREE.Vector2(0.21, 0.68)); // Upper neck taper
    points.push(new THREE.Vector2(0.24, 0.74)); // Neck collar ring
    points.push(new THREE.Vector2(0.18, 0.78)); // Neck indent

    // 4. Spherical Head
    points.push(new THREE.Vector2(0.24, 0.84)); // Lower head curve
    points.push(new THREE.Vector2(0.28, 0.94)); // Head equator
    points.push(new THREE.Vector2(0.20, 1.06)); // Upper head curve
    points.push(new THREE.Vector2(0.00, 1.10)); // Top center of head

    const latheGeo = new THREE.LatheGeometry(points, 36);
    latheGeo.computeVertexNormals();
    this.sharedPawnGeometry = latheGeo;
    return latheGeo;
  }

  private createSolidBaseDiscGeometry(): THREE.BufferGeometry {
    if (this.sharedBaseRingGeometry) return this.sharedBaseRingGeometry;

    const points: THREE.Vector2[] = [];

    // Solid Filled Base Disc Profile for Lower Stack Layers (solid color top cap, no hollow hole!)
    points.push(new THREE.Vector2(0.00, 0.00)); // Solid bottom center
    points.push(new THREE.Vector2(0.44, 0.00)); // Bottom outer edge
    points.push(new THREE.Vector2(0.45, 0.03)); // Base outer lip
    points.push(new THREE.Vector2(0.45, 0.16)); // Vertical base ring cylinder
    points.push(new THREE.Vector2(0.41, 0.20)); // Beveled top of base ring
    points.push(new THREE.Vector2(0.33, 0.22)); // Nesting shoulder step
    points.push(new THREE.Vector2(0.00, 0.22)); // Solid filled top center cap

    const latheGeo = new THREE.LatheGeometry(points, 36);
    latheGeo.computeVertexNormals();
    this.sharedBaseRingGeometry = latheGeo;
    return latheGeo;
  }

  private getStackOffset(subIdx: number, count: number): { x: number; y: number; z: number } {
    if (count <= 1) return { x: 0, y: 0, z: 0 };
    // Exact nesting height offset (0.22) for clean vertical stacking
    return {
      x: 0,
      y: subIdx * 0.22,
      z: 0
    };
  }

  public updateState(state: GameState, validTokenIds: number[]): void {
    this.lastGameState = state;

    // 0. Remove & dispose 3D pawn meshes for players that are not active in the current match (e.g. Green & Blue in 1v1 mode)
    const activeTokenIdsSet = new Set(state.tokens.map(t => t.id));
    this.pawnMeshes.forEach((mesh, tokenId) => {
      if (!activeTokenIdsSet.has(tokenId)) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        this.pawnMeshes.delete(tokenId);
        this.pawnWaypoints.delete(tokenId);
        this.pawnTargetPositions.delete(tokenId);
        this.tokenPreviousSteps.delete(tokenId);
        this.tokenPreviousPositions.delete(tokenId);
      }
    });

    if (this.cameraViewMode === 'active_turn') {
      this.updateCameraTargetPos();
    }
    const colorHexMap: { [key: string]: number } = {
      Red: 0xef4444,
      Green: 0x22c55e,
      Yellow: 0xeab308,
      Blue: 0x3b82f6
    };

    // 1. Group active tokens on board by stack key (excluding home -1; for pos 999, group per color so finished pieces stack in center)
    const positionToActiveTokens = new Map<number, number[]>();
    state.tokens.forEach(t => {
      if (t.position !== -1) {
        const stackKey = t.position === 999 ? (9990 + Math.floor(t.id / 4)) : t.position;
        const list = positionToActiveTokens.get(stackKey) || [];
        list.push(t.id);
        positionToActiveTokens.set(stackKey, list);
      }
    });

    // 2. Update stackArrivalOrder for each position / stack key
    positionToActiveTokens.forEach((activeTokenIds, stackKey) => {
      const existingOrder = this.stackArrivalOrder.get(stackKey) || [];

      // Keep existing tokens that are STILL at stackKey and did NOT move in from another tile
      const remainingInOrder = existingOrder.filter(id => {
        const isStillAtPos = activeTokenIds.includes(id);
        const prevPos = this.tokenPreviousPositions.get(id);
        const prevStackKey = (prevPos === 999) ? (9990 + Math.floor(id / 4)) : prevPos;
        return isStillAtPos && prevStackKey === stackKey;
      });

      // Find tokens that are newly at stackKey (either prevPos !== pos or wasn't in existing order)
      const newlyArrived = activeTokenIds.filter(id => !remainingInOrder.includes(id));

      // New arrival order: remaining stay at bottom/middle, newly arrived placed at end (VERY TOP)
      const newOrder = [...remainingInOrder, ...newlyArrived];
      this.stackArrivalOrder.set(stackKey, newOrder);
    });

    // 3. Clean up stackArrivalOrder for positions that no longer have any active tokens
    this.stackArrivalOrder.forEach((_, stackKey) => {
      if (!positionToActiveTokens.has(stackKey)) {
        this.stackArrivalOrder.delete(stackKey);
      }
    });

    // 4. Synchronize currentPositionGroups
    this.currentPositionGroups = new Map(this.stackArrivalOrder);

    state.tokens.forEach((token) => {
      let mesh = this.pawnMeshes.get(token.id);

      // Determine if token is a lower layer in a multi-pawn stack using physical arrival order
      const stackKey = token.position === 999 ? (9990 + Math.floor(token.id / 4)) : token.position;
      const group = this.currentPositionGroups.get(stackKey);
      const isLowerLayerInStack = group && group.length > 1 && group.indexOf(token.id) < group.length - 1;
      const targetGeo = isLowerLayerInStack ? this.createSolidBaseDiscGeometry() : this.createHollowPawnGeometry();

      if (!mesh) {
        // Create Premium Game-Ready 3D Pawn Mesh
        const pawnMat = new THREE.MeshStandardMaterial({
          color: colorHexMap[token.color] || 0xffffff,
          roughness: 0.35,
          metalness: 0.0,
          side: THREE.DoubleSide
        });

        mesh = new THREE.Mesh(targetGeo, pawnMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { tokenId: token.id };

        this.scene.add(mesh);
        this.pawnMeshes.set(token.id, mesh);
      } else if (mesh.geometry !== targetGeo) {
        // Swap geometry dynamically between full pawn and solid base disc when stacking/unstacking
        mesh.geometry = targetGeo;
      }

      // Calculate Target 3D Position
      const colorIdx = Math.floor(token.id / 4);
      let p3d = getTile3DPosition(token.position, token.id, colorIdx);

      // Apply 3D Vertical Stacking Offset: subIdx from arrival order ensures LAST-IN is on VERY TOP!
      if (group && group.length > 1) {
        const subIdx = group.indexOf(token.id);
        const offset = this.getStackOffset(subIdx, group.length);
        p3d = {
          x: p3d.x + offset.x,
          y: p3d.y + offset.y,
          z: p3d.z + offset.z
        };
      }

      const targetVec = new THREE.Vector3(p3d.x, p3d.y, p3d.z);

      const prevSteps = this.tokenPreviousSteps.get(token.id) ?? (token.position === -1 ? -1 : token.steps_taken);
      const prevPos = this.tokenPreviousPositions.get(token.id) ?? token.position;

      // Detect hit/capture: token was active on board (prevPos !== -1) and now sent back to home base (position === -1)
      if (prevPos !== -1 && token.position === -1) {
        const reversePoints = getReverseStepByStepPath(colorIdx, prevSteps > 0 ? prevSteps : 1, token.id);
        const waypointsVec = reversePoints.map(p => new THREE.Vector3(p.x, p.y, p.z));

        this.pawnWaypoints.set(token.id, waypointsVec);
        this.capturedRewindTokens.add(token.id);
        this.pawnTargetPositions.set(token.id, targetVec);
      } else if (token.steps_taken > prevSteps && prevSteps !== -1) {
        this.capturedRewindTokens.delete(token.id);
        // Generate step-by-step intermediate waypoints
        const pathPoints = getStepByStepPath(colorIdx, prevSteps, token.steps_taken, token.id);
        const waypointsVec = pathPoints.map((p, idx) => {
          if (idx === pathPoints.length - 1 && group && group.length > 1) {
            const subIdx = group.indexOf(token.id);
            const offset = this.getStackOffset(subIdx, group.length);
            return new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z);
          }
          return new THREE.Vector3(p.x, p.y, p.z);
        });
        this.pawnWaypoints.set(token.id, waypointsVec);
      } else if (prevSteps === -1 && token.steps_taken === 0) {
        this.capturedRewindTokens.delete(token.id);
        this.pawnTargetPositions.set(token.id, targetVec);
      } else {
        this.capturedRewindTokens.delete(token.id);
        this.pawnTargetPositions.set(token.id, targetVec);
      }

      this.tokenPreviousSteps.set(token.id, token.steps_taken);
      this.tokenPreviousPositions.set(token.id, token.position);
    });

    // Update Valid Moves & Selection Glow Highlight Rings
    this.updateHighlightRings(validTokenIds);
  }

  private updateHighlightRings(validTokenIds: number[]): void {
    // Remove existing highlight meshes
    this.highlightRings.forEach(ring => this.scene.remove(ring));
    this.highlightRings = [];

    if (!validTokenIds || validTokenIds.length === 0) return;

    const colorHexMap: { [key: string]: number } = {
      Red: 0xef4444,
      Green: 0x22c55e,
      Yellow: 0xffcc00,
      Blue: 0x3b82f6
    };

    validTokenIds.forEach(id => {
      const targetPos = this.pawnTargetPositions.get(id);
      if (targetPos && this.lastGameState) {
        const token = this.lastGameState.tokens.find(t => t.id === id);
        if (!token) return;
        const colName = token.color;
        const colHex = colorHexMap[colName] || 0xef4444;

        // Group container for high-contrast dual-shell triangle
        const triGroup = new THREE.Group();

        // 1. Outer Bright High-Contrast White Outline Shell (prevents color blending from top view)
        const outerMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.6,
          roughness: 0.1,
          metalness: 0.9,
          side: THREE.DoubleSide
        });
        const outerGeo = new THREE.ConeGeometry(0.28, 0.50, 3);
        outerGeo.rotateX(Math.PI);
        const outerMesh = new THREE.Mesh(outerGeo, outerMat);

        // 2. Inner Piece-Colored High-Gloss Core Pyramid
        const innerMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 0.5,
          roughness: 0.15,
          metalness: 0.8
        });
        const innerGeo = new THREE.ConeGeometry(0.23, 0.46, 3);
        innerGeo.rotateX(Math.PI);
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        innerMesh.position.set(0, -0.01, 0);

        triGroup.add(outerMesh);
        triGroup.add(innerMesh);

        // Always compute float height relative to the VERY TOP of the stack on that tile
        const group = this.currentPositionGroups.get(token.position);
        const stackCount = group ? group.length : 1;
        const topStackYOffset = (stackCount - 1) * 0.22;

        const colorIdx = Math.floor(token.id / 4);
        const baseTileP3D = getTile3DPosition(token.position, token.id, colorIdx);
        const floatY = baseTileP3D.y + topStackYOffset + 1.45;

        triGroup.position.set(targetPos.x, floatY, targetPos.z);
        triGroup.userData = { id, baseFloatY: floatY, innerMat };

        this.scene.add(triGroup);
        this.highlightRings.push(triGroup as unknown as THREE.Mesh);
      }
    });
  }

  public setOnTokenClicked(callback: (primaryTokenId: number, stackTokenIds: number[]) => void): void {
    this.onTokenClickedCallback = callback;
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
  }

  private onPointerUp(event: PointerEvent): void {
    const dx = Math.abs(event.clientX - this.pointerDownX);
    const dy = Math.abs(event.clientY - this.pointerDownY);

    // Only register as click if pointer moved less than 6px (otherwise it was an orbit/drag)
    if (dx > 6 || dy > 6) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(Array.from(this.pawnMeshes.values()), true);

    if (intersects.length > 0) {
      const hitTokenIds: number[] = [];
      intersects.forEach(hit => {
        let object: THREE.Object3D | null = hit.object;
        while (object && object.userData.tokenId === undefined && object.parent) {
          object = object.parent;
        }
        if (object && object.userData.tokenId !== undefined) {
          const id = object.userData.tokenId as number;
          if (!hitTokenIds.includes(id)) {
            hitTokenIds.push(id);
          }
        }
      });

      if (hitTokenIds.length > 0) {
        const primaryId = hitTokenIds[0];
        const allStackIds = new Set<number>(hitTokenIds);

        // Include any other tokens sharing the exact same board tile position as primaryId
        if (this.lastGameState) {
          const primaryToken = this.lastGameState.tokens.find(t => t.id === primaryId);
          if (primaryToken && primaryToken.position !== -1 && primaryToken.position !== 999) {
            this.lastGameState.tokens.forEach(t => {
              if (t.position === primaryToken.position) {
                allStackIds.add(t.id);
              }
            });
          }
        }

        if (this.onTokenClickedCallback) {
          this.onTokenClickedCallback(primaryId, Array.from(allStackIds));
        }
      }
    }
  }

  public setCameraViewMode(mode: CameraViewMode, playerColorIdx = this.myPlayerColor): void {
    this.cameraViewMode = mode;
    this.myPlayerColor = playerColorIdx;

    const isFree = mode === 'free';
    if (this.controls) {
      this.controls.enableRotate = isFree;
      this.controls.enablePan = isFree;
      this.controls.enableZoom = isFree;
      this.controls.target.set(0, 0, 0);
      if (mode === 'top') {
        this.camera.up.set(0, 0, -1);
      } else {
        this.camera.up.set(0, 1, 0);
      }
      this.controls.update();
    }

    this.updateCameraTargetPos();
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    if (this.dirLight) {
      this.dirLight.castShadow = enabled;
    }
  }

  public updateCameraTargetPos(): void {
    if (this.cameraViewMode === 'free') {
      this.isTransitioningCamera = false;
      return;
    }

    let targetPos = new THREE.Vector3(0, 16, 14);
    const targetLookAt = new THREE.Vector3(0, 0, 0);

    if (this.cameraViewMode === 'top') {
      const aspect = this.container.clientWidth / this.container.clientHeight;
      const topY = aspect < 1.0 ? Math.min(48, Math.max(22, 22 / aspect)) : 22;
      targetPos.set(0, topY, 0.001);
      this.camera.up.set(0, 0, -1);
    } else if (this.cameraViewMode === 'home' || this.cameraViewMode === 'active_turn') {
      this.camera.up.set(0, 1, 0);
      const activeIdx = this.cameraViewMode === 'active_turn'
        ? (this.lastGameState ? this.lastGameState.current_turn : 0)
        : this.myPlayerColor;

      let colorIdx = activeIdx;
      if (this.lastGameState && this.lastGameState.num_players === 2) {
        colorIdx = activeIdx === 0 ? 0 : 2; // Red (0) vs Yellow (2)
      } else if (this.lastGameState && this.lastGameState.num_players === 3) {
        colorIdx = activeIdx === 0 ? 0 : activeIdx === 1 ? 1 : 2; // Red (0), Green (1), Yellow (2)
      }

      const homePosList = [
        new THREE.Vector3(-14, 16, -14), // Red (Top-Left)
        new THREE.Vector3(14, 16, -14),  // Green (Top-Right)
        new THREE.Vector3(14, 16, 14),   // Yellow (Bottom-Right)
        new THREE.Vector3(-14, 16, 14)   // Blue (Bottom-Left)
      ];

      targetPos = homePosList[Math.max(0, colorIdx) % 4] || homePosList[0];
    }

    this.targetCameraPos.copy(targetPos);
    this.targetCameraLookAt.copy(targetLookAt);
    this.isTransitioningCamera = true;
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    // Smooth Camera Lerp Transition
    if (this.isTransitioningCamera) {
      this.camera.position.lerp(this.targetCameraPos, 0.1);
      this.controls.target.lerp(this.targetCameraLookAt, 0.1);
      this.controls.update();

      if (this.camera.position.distanceTo(this.targetCameraPos) < 0.05) {
        this.camera.position.copy(this.targetCameraPos);
        this.controls.target.copy(this.targetCameraLookAt);
        this.controls.update();
        this.isTransitioningCamera = false;
      }
    } else {
      this.controls.update();
    }

    // Step-by-Step Hopping or Reverse Backward Track Drag Animation
    this.pawnMeshes.forEach((mesh, id) => {
      const isReverseRewind = this.capturedRewindTokens.has(id);
      const waypoints = this.pawnWaypoints.get(id);

      if (waypoints && waypoints.length > 0) {
        const currentTarget = waypoints[0];
        const dist = mesh.position.distanceTo(currentTarget);

        if (isReverseRewind) {
          // Fast smooth sliding drag along track blocks in reverse
          const speed = 0.85; // Rapid smooth sliding speed per track cell
          mesh.position.x += (currentTarget.x - mesh.position.x) * speed;
          mesh.position.z += (currentTarget.z - mesh.position.z) * speed;
          mesh.position.y = 0.28; // Slide flat on track surface

          if (dist < 0.15) {
            mesh.position.copy(currentTarget);
            waypoints.shift();
            if (waypoints.length === 0) {
              this.capturedRewindTokens.delete(id);
              this.pawnTargetPositions.set(id, currentTarget);
            }
          }
        } else {
          // Standard forward hopping step animation
          mesh.position.x += (currentTarget.x - mesh.position.x) * 0.28;
          mesh.position.z += (currentTarget.z - mesh.position.z) * 0.28;

          const progress = Math.min(1.0, 1.0 - (dist / 1.2));
          mesh.position.y = currentTarget.y + Math.sin(progress * Math.PI) * 0.35;

          if (dist < 0.12) {
            mesh.position.copy(currentTarget);
            waypoints.shift();
            sounds.playStep();
            if (waypoints.length === 0) {
              this.pawnTargetPositions.set(id, currentTarget);
            }
          }
        }
      } else {
        const target = this.pawnTargetPositions.get(id);
        if (target) {
          mesh.position.lerp(target, 0.18);
        }
      }
    });

    // Dice Spin Animation
    if (this.isDiceRolling && this.diceMesh) {
      this.diceMesh.rotation.x += (this.diceTargetRotation.x - this.diceMesh.rotation.x) * 0.25;
      this.diceMesh.rotation.y += (this.diceTargetRotation.y - this.diceMesh.rotation.y) * 0.25;
      this.diceMesh.rotation.z += (this.diceTargetRotation.z - this.diceMesh.rotation.z) * 0.25;
    }

    // Smooth Rounding Rotation, Pulsing Emissive Glow, Vertical Bobbing & Piece Position Tracking
    const animTime = performance.now() * 0.005;
    this.highlightRings.forEach(tri => {
      tri.rotation.y += 0.035;

      // Vertical floating bobbing animation
      const baseFloatY = (tri.userData.baseFloatY as number | undefined) ?? tri.position.y;
      tri.position.y = baseFloatY + Math.sin(animTime * 5) * 0.08;

      // Pulse emissive intensity for glowing visual aura
      const innerMat = tri.userData.innerMat as THREE.MeshStandardMaterial | undefined;
      if (innerMat) {
        innerMat.emissiveIntensity = 0.4 + Math.sin(animTime * 8) * 0.25;
      }

      const tokenId = tri.userData.id;
      if (typeof tokenId === 'number') {
        const mesh = this.pawnMeshes.get(tokenId);
        if (mesh) {
          tri.position.x = mesh.position.x;
          tri.position.z = mesh.position.z;
        }
      }
    });

    // Update Floating Multi-Piece Stack Color Arrow Badges
    if (this.lastGameState) {
      this.updateStackBadges();
    }

    // Update Floating Sleep / Snoring Emoji Position
    this.updateSleepEmojiPosition();

    // Update Floating King Crown & Ranking Badges Position
    this.updateCrownBadges();

    this.renderer.render(this.scene, this.camera);
  }

  private lastGameState: GameState | null = null;

  private updateStackBadges(): void {
    // 1. Clear previous 3D stack indicator meshes from scene
    while (this.stackIndicatorGroup.children.length > 0) {
      const child = this.stackIndicatorGroup.children[0];
      if ('geometry' in child && (child as THREE.Mesh).geometry) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.stackIndicatorGroup.remove(child);
    }

    const overlayContainer = document.getElementById('stack-overlay-container');
    if (overlayContainer) {
      overlayContainer.innerHTML = '';
    }

    if (!this.lastGameState) return;

    const state = this.lastGameState;
    const positionGroups: Map<number, { id: number; color: string }[]> = new Map();

    state.tokens.forEach(t => {
      if (t.position !== -1 && t.position !== 999) {
        const group = positionGroups.get(t.position) || [];
        group.push({ id: t.id, color: t.color });
        positionGroups.set(t.position, group);
      }
    });

    const stackPositions: { posCode: number; colorCounts: { [color: string]: number }; totalCount: number; sampleToken: { id: number; color: string } }[] = [];

    positionGroups.forEach((tokens, posCode) => {
      if (tokens.length >= 2) {
        const colorCounts: { [color: string]: number } = {};
        tokens.forEach(t => {
          colorCounts[t.color] = (colorCounts[t.color] || 0) + 1;
        });

        // ONLY show indicators when there are DIFFERENT colors in the stack (e.g. Red + Blue)
        const distinctColors = Object.keys(colorCounts);
        if (distinctColors.length >= 2) {
          stackPositions.push({
            posCode,
            colorCounts,
            totalCount: tokens.length,
            sampleToken: tokens[0]
          });
        }
      }
    });

    const colorHexMap: { [key: string]: number } = {
      Red: 0xef4444,
      Green: 0x22c55e,
      Yellow: 0xffcc00,
      Blue: 0x3b82f6
    };

    const dotRadius = 0.055;
    const dotDiameter = dotRadius * 2;
    const dotSpacing = 0.04;

    stackPositions.forEach(item => {
      const sampleColorIdx = ['Red', 'Green', 'Yellow', 'Blue'].indexOf(item.sampleToken.color);
      const p3d = getTile3DPosition(item.posCode, item.sampleToken.id, Math.max(0, sampleColorIdx));

      // Calculate compact box dimensions for dots
      const totalDots = item.totalCount;
      const dotRadius = 0.055;
      const dotDiameter = dotRadius * 2;
      const dotSpacing = 0.04;

      const dotLineLength = totalDots * dotDiameter + (totalDots - 1) * dotSpacing + 0.08;
      const boxBreadth = dotDiameter + 0.08;

      // Determine arm orientation: Vertical arm (|z| > |x|) vs Horizontal arm (|x| >= |z|)
      const isVerticalArm = Math.abs(p3d.z) > Math.abs(p3d.x);

      let sideTrackX = p3d.x;
      let sideTrackZ = p3d.z;

      if (isVerticalArm) {
        // Track runs in Z -> Side track is in X (perpendicular to track)
        const offsetDirection = p3d.x >= 0 ? 1 : -1;
        sideTrackX = p3d.x + offsetDirection * 0.70;
      } else {
        // Track runs in X -> Side track is in Z (perpendicular to track)
        const offsetDirection = p3d.z >= 0 ? 1 : -1;
        sideTrackZ = p3d.z + offsetDirection * 0.70;
      }

      const boardSurfaceY = 0.285; // Raised slightly above board floor (y = 0.26) for zero Z-fighting & 100% clean visibility

      // 1. Dark compact background box plane fixed on side track margin
      const boxWidth = isVerticalArm ? boxBreadth : dotLineLength;
      const boxHeight = isVerticalArm ? dotLineLength : boxBreadth;

      const bgGeo = new THREE.PlaneGeometry(boxWidth, boxHeight);
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x090d16, side: THREE.DoubleSide, depthTest: true });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.rotation.x = -Math.PI / 2;
      bgMesh.position.set(sideTrackX, boardSurfaceY, sideTrackZ);
      this.stackIndicatorGroup.add(bgMesh);

      // 2. Render small flat circular dot meshes inside dark background box along the side track line
      const startOffset = -dotLineLength / 2 + 0.04 + dotRadius;
      let dotIdx = 0;

      const order = ['Red', 'Green', 'Yellow', 'Blue'];
      order.forEach(col => {
        const cnt = item.colorCounts[col];
        if (cnt && cnt > 0) {
          const colHex = colorHexMap[col] || 0xffffff;
          for (let i = 0; i < cnt; i++) {
            const stepOffset = startOffset + dotIdx * (dotDiameter + dotSpacing);
            const posX = isVerticalArm ? 0 : stepOffset;
            const posZ = isVerticalArm ? stepOffset : 0;

            // Add dark border ring underneath yellow dot to ensure 100% contrast with yellow track tiles
            if (col === 'Yellow') {
              const borderGeo = new THREE.CircleGeometry(dotRadius + 0.015, 16);
              const borderMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
              const borderMesh = new THREE.Mesh(borderGeo, borderMat);
              borderMesh.rotation.x = -Math.PI / 2;
              borderMesh.position.set(sideTrackX + posX, boardSurfaceY + 0.002, sideTrackZ + posZ);
              this.stackIndicatorGroup.add(borderMesh);
            }

            const dotGeo = new THREE.CircleGeometry(dotRadius, 16);
            const dotMat = new THREE.MeshBasicMaterial({ color: colHex, side: THREE.DoubleSide });
            const dotMesh = new THREE.Mesh(dotGeo, dotMat);
            dotMesh.rotation.x = -Math.PI / 2;
            dotMesh.position.set(sideTrackX + posX, boardSurfaceY + 0.004, sideTrackZ + posZ);
            this.stackIndicatorGroup.add(dotMesh);

            dotIdx++;
          }
        }
      });
    });
  }

  public triggerCaptureEmojis(hitterColorIdx: number, victimColorIdx: number): void {
    const overlayContainer = document.getElementById('emoji-overlay-container');
    if (!overlayContainer) return;

    // Home corner 3D coordinates for Red(0), Green(1), Yellow(2), Blue(3)
    const homeCorners = [
      new THREE.Vector3(-4.45, 1.8, -4.45), // Red - Top-Left
      new THREE.Vector3(4.45, 1.8, -4.45),  // Green - Top-Right
      new THREE.Vector3(4.45, 1.8, 4.45),   // Yellow - Bottom-Right
      new THREE.Vector3(-4.45, 1.8, 4.45)   // Blue - Bottom-Left
    ];

    const colorNames = ['Red', 'Green', 'Yellow', 'Blue'];
    const hitterEmojiList = ['😂', '🤣', '😆', '🤪', '😈', '🔥', '💥', '😎'];
    const victimEmojiList = ['😭', '😱', '🥺', '😡', '💀', '💔', '😭', '🤡'];

    const hitterLabels = ['HA HA!', 'GOT YOU!', 'BOOM!', 'TROLLING!', 'BYE BYE!'];
    const victimLabels = ['OH NO!', 'HIT!', 'OUCH!', 'SO CLOSE!', 'NOOO!'];

    const createBubble = (colorIdx: number, isHitter: boolean) => {
      const safeIdx = Math.max(0, Math.floor(colorIdx)) % 4;
      const worldPos = homeCorners[safeIdx].clone();

      // Project 3D vector to screen NDC space
      const vector = worldPos.clone();
      vector.project(this.camera);

      const canvas = this.renderer.domElement;
      const widthHalf = canvas.clientWidth / 2;
      const heightHalf = canvas.clientHeight / 2;

      const screenX = (vector.x * widthHalf) + widthHalf;
      const screenY = -(vector.y * heightHalf) + heightHalf;

      const bubble = document.createElement('div');
      bubble.className = `capture-emoji-bubble ${isHitter ? 'hitter' : 'victim'}`;
      bubble.style.left = `${screenX}px`;
      bubble.style.top = `${screenY}px`;

      const emojiList = isHitter ? hitterEmojiList : victimEmojiList;
      const labelList = isHitter ? hitterLabels : victimLabels;

      const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
      const labelText = labelList[Math.floor(Math.random() * labelList.length)];

      bubble.innerHTML = `
        <div class="emoji-icon">${emoji}</div>
        <div class="emoji-label">${colorNames[safeIdx]}: ${labelText}</div>
      `;

      overlayContainer.appendChild(bubble);

      setTimeout(() => {
        bubble.remove();
      }, 2200);
    };

    // Trigger hitter laughing emoji and victim crying emoji
    createBubble(hitterColorIdx, true);
    createBubble(victimColorIdx, false);
  }

  private sleepEmojiElement: HTMLElement | null = null;
  public activeSleepPlayerIdx: number | null = null;

  public showSleepEmoji(playerColorIdx: number): void {
    if (this.activeSleepPlayerIdx === playerColorIdx && this.sleepEmojiElement) return;

    this.hideSleepEmoji();
    this.activeSleepPlayerIdx = playerColorIdx;

    const overlayContainer = document.getElementById('emoji-overlay-container');
    if (!overlayContainer) return;

    const colorNames = ['Red', 'Green', 'Yellow', 'Blue'];
    const safeIdx = Math.max(0, Math.floor(playerColorIdx)) % 4;

    const bubble = document.createElement('div');
    bubble.className = `sleep-emoji-bubble player-${safeIdx}`;

    bubble.innerHTML = `
      <div class="sleep-zzz-particles">
        <span>💤</span>
        <span>😴</span>
        <span>💤</span>
      </div>
      <div class="sleep-label">${colorNames[safeIdx]} is Sleeping! Zzz...</div>
    `;

    overlayContainer.appendChild(bubble);
    this.sleepEmojiElement = bubble;
    this.updateSleepEmojiPosition();
  }

  public hideSleepEmoji(): void {
    if (this.sleepEmojiElement) {
      this.sleepEmojiElement.remove();
      this.sleepEmojiElement = null;
    }
    this.activeSleepPlayerIdx = null;
  }

  public updateSleepEmojiPosition(): void {
    if (this.activeSleepPlayerIdx === null || !this.sleepEmojiElement) return;

    const homeCorners = [
      new THREE.Vector3(-4.45, 2.2, -4.45), // Red
      new THREE.Vector3(4.45, 2.2, -4.45),  // Green
      new THREE.Vector3(4.45, 2.2, 4.45),   // Yellow
      new THREE.Vector3(-4.45, 2.2, 4.45)   // Blue
    ];

    const safeIdx = Math.max(0, Math.floor(this.activeSleepPlayerIdx)) % 4;
    const worldPos = homeCorners[safeIdx].clone();

    const vector = worldPos.clone();
    vector.project(this.camera);

    const canvas = this.renderer.domElement;
    const widthHalf = canvas.clientWidth / 2;
    const heightHalf = canvas.clientHeight / 2;

    const screenX = (vector.x * widthHalf) + widthHalf;
    const screenY = -(vector.y * heightHalf) + heightHalf;

    this.sleepEmojiElement.style.left = `${screenX}px`;
    this.sleepEmojiElement.style.top = `${screenY}px`;
  }

  public updateCrownBadges(): void {
    let container = document.getElementById('crown-overlay-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'crown-overlay-container';
      container.style.position = 'absolute';
      container.style.inset = '0';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '160';
      container.style.overflow = 'hidden';
      this.container.appendChild(container);
    }

    container.innerHTML = '';

    if (!this.lastGameState) return;

    const ranks = this.lastGameState.winners_rank || (this.lastGameState.winner !== null ? [this.lastGameState.winner] : []);
    if (!ranks || ranks.length === 0) return;

    const homeCorners = [
      new THREE.Vector3(-4.45, 2.5, -4.45), // Red (0)
      new THREE.Vector3(4.45, 2.5, -4.45),  // Green (1)
      new THREE.Vector3(4.45, 2.5, 4.45),   // Yellow (2)
      new THREE.Vector3(-4.45, 2.5, 4.45)   // Blue (3)
    ];

    const animTime = performance.now() * 0.003;
    const rankLabels = ['👑 1st KING', '🥈 2nd', '🥉 3rd', '4th'];

    ranks.forEach((playerIdx, rankIdx) => {
      const safeIdx = Math.max(0, Math.floor(playerIdx)) % 4;
      const corner = homeCorners[safeIdx];
      if (!corner) return;

      const worldPos = corner.clone();
      worldPos.y += Math.sin(animTime * 3 + safeIdx) * 0.15; // Gentle floating bobbing

      const vector = worldPos.clone();
      vector.project(this.camera);

      const canvas = this.renderer.domElement;
      const widthHalf = canvas.clientWidth / 2;
      const heightHalf = canvas.clientHeight / 2;

      const screenX = (vector.x * widthHalf) + widthHalf;
      const screenY = -(vector.y * heightHalf) + heightHalf;

      const badge = document.createElement('div');
      badge.className = `crown-badge rank-${Math.min(3, rankIdx + 1)}`;
      badge.style.left = `${screenX}px`;
      badge.style.top = `${screenY}px`;
      badge.innerHTML = `<span>${rankLabels[rankIdx] || 'Finished'}</span>`;

      container.appendChild(badge);
    });
  }

  private updateCameraAspect(): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.aspect = aspect;

    if (this.cameraViewMode === 'top') {
      const topY = aspect < 1.0 ? Math.min(48, Math.max(22, 22 / aspect)) : 22;
      this.targetCameraPos.set(0, topY, 0.001);
      if (!this.isTransitioningCamera) {
        this.camera.position.set(0, topY, 0.001);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
      }
    } else if (aspect < 1.0) {
      const zoomFactor = Math.max(1.0, 1.25 / aspect);
      if (!this.isTransitioningCamera && this.cameraViewMode === 'free') {
        this.camera.position.set(0, 16 * zoomFactor, 14 * zoomFactor);
      }
    }

    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private onWindowResize(): void {
    this.updateCameraAspect();
  }
}
