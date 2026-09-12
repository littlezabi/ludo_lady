import { initWasmModule, newGame, rollDiceState, getValidMoveTokenIds, applyMoveToken, GameState } from './wasmLoader';
import { Ludo3DEngine, CameraViewMode } from './engine';
import { joinRoom, broadcastGameState, generateRoomCode } from './network';
import { sounds } from './soundEffects';

let engine: Ludo3DEngine;
let gameState: GameState;
let validTokenIds: number[] = [];
let selectedDebugTokenId: number | null = null;
let roomCode: string | null = null;
let generatedRoomCode: string = '';

async function bootstrap() {
  const loadingOverlay = document.getElementById('loading-overlay')!;
  const canvasContainer = document.getElementById('canvas-container')!;

  try {
    // 1. Initialize WASM Engine
    await initWasmModule();
    console.log("WASM Core Logic loaded.");

    // 2. Initialize 3D Viewport
    engine = new Ludo3DEngine(canvasContainer);

    // 3. Initialize Default 4-Player Local Game State
    gameState = newGame(4);
    updateUI();

    // 4. Bind 3D Pawn Click/Touch
    engine.setOnTokenClicked((tokenId: number) => {
      handlePawnClick(tokenId);
    });

    // 5. Setup Menu Tabs and Control Listeners
    setupMenuControls();
    setupConfigControls();
    setupUIControls();

    // 6. Check URL query params for direct room join link (?room=123456)
    checkURLRoomCode();

    // Hide Loading Screen
    loadingOverlay.style.opacity = '0';
    setTimeout(() => loadingOverlay.remove(), 400);

  } catch (err) {
    console.error("Initialization error:", err);
    loadingOverlay.innerHTML = `<div style="color:#ef4444; padding:2rem;">Failed to load WASM engine module: ${err}</div>`;
  }
}

function handleRemoteStateUpdate(remoteState: GameState) {
  if (gameState && gameState.tokens && remoteState.tokens) {
    let victimColorIdx: number | null = null;
    const hitterColorIdx = gameState.current_turn;
    remoteState.tokens.forEach((t, idx) => {
      const prevT = gameState.tokens[idx];
      const tColorIdx = Math.floor(t.id / 4);
      if (prevT && prevT.position >= 0 && t.position === -1 && tColorIdx !== hitterColorIdx) {
        victimColorIdx = tColorIdx;
      }
    });

    if (victimColorIdx !== null) {
      sounds.playCapture();
      engine.triggerCaptureEmojis(hitterColorIdx, victimColorIdx);
    }
  }

  gameState = remoteState;
  validTokenIds = getValidMoveTokenIds(gameState);
  updateUI();
}

function setupMenuControls() {
  const mainMenuOverlay = document.getElementById('main-menu-overlay')!;
  const tabCreate = document.getElementById('tab-create')!;
  const tabJoin = document.getElementById('tab-join')!;
  const tabLocal = document.getElementById('tab-local')!;

  const contentCreate = document.getElementById('content-create')!;
  const contentJoin = document.getElementById('content-join')!;
  const contentLocal = document.getElementById('content-local')!;

  const generatedCodeEl = document.getElementById('generated-room-code')!;
  const btnCopy = document.getElementById('btn-copy-generated')!;

  // Generate Initial Room Code
  generatedRoomCode = generateRoomCode();
  generatedCodeEl.textContent = generatedRoomCode;

  // Tab Switching Logic
  const switchTab = (activeBtn: HTMLElement, activeContent: HTMLElement) => {
    sounds.playClick();
    [tabCreate, tabJoin, tabLocal].forEach(btn => btn.classList.remove('active'));
    [contentCreate, contentJoin, contentLocal].forEach(content => content.classList.remove('active'));

    activeBtn.classList.add('active');
    activeContent.classList.add('active');
  };

  tabCreate.addEventListener('click', () => switchTab(tabCreate, contentCreate));
  tabJoin.addEventListener('click', () => switchTab(tabJoin, contentJoin));
  tabLocal.addEventListener('click', () => switchTab(tabLocal, contentLocal));

  // Copy Room Code
  btnCopy.addEventListener('click', () => {
    sounds.playClick();
    navigator.clipboard.writeText(generatedRoomCode).then(() => {
      btnCopy.textContent = '✓ Copied!';
      setTimeout(() => {
        btnCopy.textContent = '📋 Copy';
      }, 2000);
    });
  });

  // Create Room Button
  document.getElementById('btn-start-created-room')?.addEventListener('click', () => {
    sounds.playClick();
    const select = document.getElementById('menu-player-count') as HTMLSelectElement;
    const numPlayers = parseInt(select.value, 10);

    roomCode = generatedRoomCode;
    gameState = newGame(numPlayers);
    validTokenIds = [];

    // Connect to Supabase Room Channel
    joinRoom(roomCode, (remoteState) => {
      handleRemoteStateUpdate(remoteState);
    });

    broadcastGameState(gameState);

    updateRoomDisplay(`Room: ${roomCode}`);
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Join Room Button
  document.getElementById('btn-submit-join-room')?.addEventListener('click', () => {
    sounds.playClick();
    const input = document.getElementById('menu-join-code-input') as HTMLInputElement;
    const code = input.value.trim().toUpperCase();

    if (!code) {
      alert("Please enter a valid room code.");
      return;
    }

    roomCode = code;
    joinRoom(roomCode, (remoteState) => {
      handleRemoteStateUpdate(remoteState);
    });

    updateRoomDisplay(`Room: ${roomCode}`);
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Start Local Game Button
  document.getElementById('btn-start-local-game')?.addEventListener('click', () => {
    sounds.playClick();
    roomCode = null;
    gameState = newGame(4);
    validTokenIds = [];

    updateRoomDisplay("Local Match");
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Open Main Menu Button in Header
  document.getElementById('btn-open-menu')?.addEventListener('click', () => {
    sounds.playClick();
    mainMenuOverlay.classList.remove('hidden');
  });

  document.getElementById('header-logo')?.addEventListener('click', () => {
    sounds.playClick();
    mainMenuOverlay.classList.remove('hidden');
  });

  document.getElementById('btn-winner-re-open-menu')?.addEventListener('click', () => {
    sounds.playClick();
    document.getElementById('winner-modal')!.style.display = 'none';
    mainMenuOverlay.classList.remove('hidden');
  });
}

function checkURLRoomCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('room');

  if (codeParam) {
    const input = document.getElementById('menu-join-code-input') as HTMLInputElement;
    if (input) {
      input.value = codeParam.toUpperCase();
    }
    const tabJoin = document.getElementById('tab-join')!;
    const contentJoin = document.getElementById('content-join')!;
    if (tabJoin && contentJoin) {
      tabJoin.click();
    }
  }
}

function updateRoomDisplay(label: string) {
  const headerRoomCode = document.getElementById('header-room-code');
  if (headerRoomCode) {
    headerRoomCode.textContent = label;
  }
}

function handleRollDice() {
  if (gameState.winner !== null) return;
  if (gameState.dice_roll > 0 && validTokenIds.length > 0) return; // Must move first

  sounds.playClick();
  gameState = rollDiceState(gameState);
  engine.triggerDiceAnimation(gameState.dice_roll);

  validTokenIds = getValidMoveTokenIds(gameState);

  if (roomCode) {
    broadcastGameState(gameState);
  }

  updateUI();
}

function moveSelectedTokenDebugForward(tokenId: number) {
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token || token.position === 999) return; // Already finished

  const colorIdxMap: { [key: string]: number } = { Red: 0, Green: 1, Yellow: 2, Blue: 3 };
  const colorIdx = colorIdxMap[token.color] ?? 0;

  const startTrackMap = [0, 13, 26, 39];
  const stretchBaseMap = [100, 200, 300, 400];

  const prevSteps = token.steps_taken;
  let newSteps = token.steps_taken + 1;

  if (prevSteps === 0 || token.position === -1) {
    newSteps = 1;
    token.position = startTrackMap[colorIdx];
  } else if (newSteps <= 51) {
    token.position = (startTrackMap[colorIdx] + newSteps - 1) % 52;
  } else if (newSteps >= 52 && newSteps <= 56) {
    token.position = stretchBaseMap[colorIdx] + (newSteps - 51);
  } else if (newSteps >= 57) {
    token.position = 999;
    newSteps = 57;
  }

  token.steps_taken = newSteps;
  gameState.last_action = `[DEBUG] ${token.color} Pawn #${token.id} moved step ${newSteps}`;

  sounds.playStep();
  updateUI();

  if (roomCode) {
    broadcastGameState(gameState);
  }
}

function handlePawnClick(tokenId: number) {
  if (gameState.dice_roll > 0 && gameState.winner === null && validTokenIds.includes(tokenId)) {
    const oldTokens = gameState.tokens.map(t => ({ color_idx: Math.floor(t.id / 4), position: t.position }));
    const hitterColorIdx = gameState.current_turn;

    gameState = applyMoveToken(gameState, tokenId);
    validTokenIds = [];
    selectedDebugTokenId = null;
    engine.selectedDebugTokenId = null;

    // Detect if a piece was captured and sent back to base (-1)
    let victimColorIdx: number | null = null;
    gameState.tokens.forEach((t, idx) => {
      const oldT = oldTokens[idx];
      const tColorIdx = Math.floor(t.id / 4);
      if (oldT && oldT.position >= 0 && t.position === -1 && tColorIdx !== hitterColorIdx) {
        victimColorIdx = tColorIdx;
      }
    });

    if (victimColorIdx !== null) {
      sounds.playCapture();
      engine.triggerCaptureEmojis(hitterColorIdx, victimColorIdx);
    } else if (gameState.last_action.includes("captured")) {
      sounds.playCapture();
    }

    if (gameState.winner !== null) {
      sounds.playWinFanfare();
    }

    if (roomCode) {
      broadcastGameState(gameState);
    }
  } else {
    selectedDebugTokenId = tokenId;
    engine.selectedDebugTokenId = selectedDebugTokenId;
  }

  updateUI();
}

function updateUI() {
  engine.selectedDebugTokenId = selectedDebugTokenId;
  engine.updateState(gameState, validTokenIds);

  const turnColors = ['Red', 'Green', 'Yellow', 'Blue'];
  const turnHex = ['#ef4444', '#22c55e', '#eab308', '#3b82f6'];

  const currentTurnColor = turnColors[gameState.current_turn];
  const currentTurnHex = turnHex[gameState.current_turn];

  // Turn Badge
  const turnBadge = document.getElementById('turn-badge')!;
  turnBadge.textContent = `${currentTurnColor}'s Turn`;
  turnBadge.style.backgroundColor = `${currentTurnHex}22`;
  turnBadge.style.color = currentTurnHex;
  turnBadge.style.borderColor = currentTurnHex;

  // Dice Display Value
  const diceValueEl = document.getElementById('dice-value')!;
  diceValueEl.textContent = gameState.dice_roll > 0 ? `${gameState.dice_roll}` : '🎲';

  // Action Status Log
  const actionLogEl = document.getElementById('action-log')!;
  actionLogEl.textContent = `${gameState.last_action}`;

  // Roll Button State
  const btnRoll = document.getElementById('btn-roll') as HTMLButtonElement;
  if (gameState.dice_roll > 0 && validTokenIds.length > 0) {
    btnRoll.disabled = true;
    btnRoll.classList.add('opacity-50');
  } else {
    btnRoll.disabled = gameState.winner !== null;
    btnRoll.classList.remove('opacity-50');
  }

  // Winner Announcement Modal
  if (gameState.winner !== null) {
    const winnerModal = document.getElementById('winner-modal')!;
    const winnerText = document.getElementById('winner-text')!;
    winnerText.textContent = `🎉 PLAYER ${turnColors[gameState.winner]} HAS WON!`;
    winnerModal.style.display = 'flex';
  }
}

function setupUIControls() {
  document.getElementById('btn-roll')?.addEventListener('click', handleRollDice);

  // Debug Right Arrow Key Step Forward Listener
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.code === 'ArrowRight') {
      if (selectedDebugTokenId !== null) {
        moveSelectedTokenDebugForward(selectedDebugTokenId);
      }
    }
  });
}

function setupConfigControls() {
  const configModal = document.getElementById('config-modal')!;
  const btnOpenConfig = document.getElementById('btn-open-config')!;
  const btnCloseConfig = document.getElementById('btn-close-config')!;

  btnOpenConfig.addEventListener('click', () => {
    sounds.playClick();
    configModal.style.display = 'flex';
  });

  btnCloseConfig.addEventListener('click', () => {
    sounds.playClick();
    configModal.style.display = 'none';
  });

  configModal.addEventListener('click', (e) => {
    if (e.target === configModal) {
      configModal.style.display = 'none';
    }
  });

  // Load Saved Preferences
  const savedCameraView = (localStorage.getItem('ludo_camera_mode') as CameraViewMode) || 'free';
  const savedPlayerColor = parseInt(localStorage.getItem('ludo_player_color') || '0', 10);
  const savedSoundMuted = localStorage.getItem('ludo_sound_muted') === 'true';
  const savedSoundVolume = parseInt(localStorage.getItem('ludo_sound_volume') || '100', 10);
  const savedShadows = localStorage.getItem('ludo_shadows_enabled') !== 'false';

  // Apply to Sound Manager
  sounds.muted = savedSoundMuted;
  sounds.volume = savedSoundVolume / 100;

  // Apply to Engine
  engine.setCameraViewMode(savedCameraView, savedPlayerColor);
  engine.setShadowsEnabled(savedShadows);

  // Sync UI Elements
  // 1. Camera View Mode Buttons
  const viewBtns = document.querySelectorAll<HTMLButtonElement>('.config-view-btn');
  viewBtns.forEach(btn => {
    const view = btn.dataset.view as CameraViewMode;
    if (view === savedCameraView) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }

    btn.addEventListener('click', () => {
      sounds.playClick();
      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const selectedView = btn.dataset.view as CameraViewMode;
      localStorage.setItem('ludo_camera_mode', selectedView);
      engine.setCameraViewMode(selectedView);
    });
  });

  // 2. Player Color Chips
  const colorChips = document.querySelectorAll<HTMLButtonElement>('.config-color-chip');
  colorChips.forEach(chip => {
    const colorIdx = parseInt(chip.dataset.color || '0', 10);
    if (colorIdx === savedPlayerColor) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }

    chip.addEventListener('click', () => {
      sounds.playClick();
      colorChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const selectedColor = parseInt(chip.dataset.color || '0', 10);
      localStorage.setItem('ludo_player_color', selectedColor.toString());
      engine.myPlayerColor = selectedColor;
      if (engine.cameraViewMode === 'home') {
        engine.updateCameraTargetPos();
      }
    });
  });

  // 3. Sound Effects Toggle
  const soundToggle = document.getElementById('config-sound-toggle') as HTMLInputElement;
  if (soundToggle) {
    soundToggle.checked = !savedSoundMuted;
    soundToggle.addEventListener('change', () => {
      sounds.playClick();
      const isMuted = !soundToggle.checked;
      sounds.muted = isMuted;
      localStorage.setItem('ludo_sound_muted', isMuted ? 'true' : 'false');
    });
  }

  // 4. Volume Slider
  const soundVolumeSlider = document.getElementById('config-sound-volume') as HTMLInputElement;
  const volumeLabel = document.getElementById('config-volume-label')!;
  if (soundVolumeSlider) {
    soundVolumeSlider.value = savedSoundVolume.toString();
    if (volumeLabel) volumeLabel.textContent = `${savedSoundVolume}%`;

    soundVolumeSlider.addEventListener('input', () => {
      const volVal = parseInt(soundVolumeSlider.value, 10);
      if (volumeLabel) volumeLabel.textContent = `${volVal}%`;
      sounds.volume = volVal / 100;
      localStorage.setItem('ludo_sound_volume', volVal.toString());
    });
  }

  // 5. Shadows Toggle
  const shadowsToggle = document.getElementById('config-shadows-toggle') as HTMLInputElement;
  if (shadowsToggle) {
    shadowsToggle.checked = savedShadows;
    shadowsToggle.addEventListener('change', () => {
      sounds.playClick();
      const enabled = shadowsToggle.checked;
      engine.setShadowsEnabled(enabled);
      localStorage.setItem('ludo_shadows_enabled', enabled ? 'true' : 'false');
    });
  }
}

window.addEventListener('DOMContentLoaded', bootstrap);

