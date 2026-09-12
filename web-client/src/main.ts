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
let isDebugModeEnabled: boolean = localStorage.getItem('ludo_debug_mode') !== 'false';

let lastTurnActionTime: number = Date.now();
let isSnoringActive: boolean = false;
let trackedTurnIdx: number = 0;

function resetIdleTimer() {
  lastTurnActionTime = Date.now();
  if (isSnoringActive) {
    isSnoringActive = false;
    sounds.stopSnoreLoop();
    if (engine) engine.hideSleepEmoji();
  }
}

function checkIdleTimer() {
  if (!gameState || gameState.winner !== null) {
    resetIdleTimer();
    return;
  }

  // Detect turn change
  if (gameState.current_turn !== trackedTurnIdx) {
    trackedTurnIdx = gameState.current_turn;
    resetIdleTimer();
    return;
  }

  const elapsedSeconds = (Date.now() - lastTurnActionTime) / 1000;
  if (elapsedSeconds >= 20) {
    if (!isSnoringActive) {
      isSnoringActive = true;
      sounds.startSnoreLoop();
      engine.showSleepEmoji(gameState.current_turn);
      const turnColors = ['Red', 'Green', 'Yellow', 'Blue'];
      gameState.last_action = `[IDLE] ${turnColors[gameState.current_turn]} is sleeping... Zzz 😴`;
      updateUI();
    }
  }
}

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
    engine.setOnTokenClicked((tokenId: number, stackTokenIds: number[]) => {
      handlePawnClick(tokenId, stackTokenIds);
    });

    // 5. Setup Menu, Config, and Debug Controls
    setupMenuControls();
    setupConfigControls();
    setupDebugControls();
    setupUIControls();

    // 6. Start 10-Second Idle Detector Interval
    setInterval(checkIdleTimer, 500);

    // 7. Check URL query params for direct room join link (?room=123456)
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
  resetIdleTimer();
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

let selectedGameMode: 'classic' | 'team' = 'classic';

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

  // Game Mode Selector Sync (Classic 4P vs 2v2 Team Mode)
  const modeBtns = document.querySelectorAll<HTMLButtonElement>('.mode-select-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      const mode = (btn.dataset.mode as 'classic' | 'team') || 'classic';
      selectedGameMode = mode;
      modeBtns.forEach(b => {
        if (b.dataset.mode === selectedGameMode) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    });
  });

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
    const isTeamMode = selectedGameMode === 'team';

    roomCode = generatedRoomCode;
    gameState = newGame(numPlayers, isTeamMode);
    validTokenIds = [];

    // Connect to Supabase Room Channel
    joinRoom(roomCode, (remoteState) => {
      handleRemoteStateUpdate(remoteState);
    });

    broadcastGameState(gameState);

    updateRoomDisplay(`Room: ${roomCode} ${isTeamMode ? '(2v2 Teams)' : ''}`);
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
    const isTeamMode = selectedGameMode === 'team';
    gameState = newGame(4, isTeamMode);
    validTokenIds = [];

    updateRoomDisplay(isTeamMode ? "Local Match (2v2 Teams)" : "Local Match");
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
  resetIdleTimer();
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

function getTargetDebugTokenId(): number | null {
  if (selectedDebugTokenId !== null) return selectedDebugTokenId;
  const currentTurn = gameState.current_turn;
  const token = gameState.tokens.find(t => Math.floor(t.id / 4) === currentTurn);
  return token ? token.id : null;
}

function moveSelectedTokenDebugForward(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token || token.position === 999) return; // Already finished

  const colorIdx = Math.floor(token.id / 4);
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
  gameState.last_action = `[CHEAT] ${token.color} Pawn #${token.id} step +1 -> Pos ${token.position}`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function moveSelectedTokenDebugBackward(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token || token.position === -1) return;

  const colorIdx = Math.floor(token.id / 4);
  const startTrackMap = [0, 13, 26, 39];
  const stretchBaseMap = [100, 200, 300, 400];

  let newSteps = token.steps_taken - 1;

  if (newSteps <= 0) {
    newSteps = 0;
    token.position = -1;
  } else if (newSteps <= 51) {
    token.position = (startTrackMap[colorIdx] + newSteps - 1) % 52;
  } else if (newSteps >= 52 && newSteps <= 56) {
    token.position = stretchBaseMap[colorIdx] + (newSteps - 51);
  }

  token.steps_taken = newSteps;
  gameState.last_action = `[CHEAT] ${token.color} Pawn #${token.id} step -1 -> Pos ${token.position}`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function teleportSelectedTokenToTrack(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token) return;

  const colorIdx = Math.floor(token.id / 4);
  const startTrackMap = [0, 13, 26, 39];

  token.position = startTrackMap[colorIdx];
  token.steps_taken = 1;
  gameState.last_action = `[CHEAT] Teleported ${token.color} Pawn #${token.id} to track start (Pos ${token.position})`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function teleportSelectedTokenToStretch(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token) return;

  const colorIdx = Math.floor(token.id / 4);
  const stretchBaseMap = [100, 200, 300, 400];

  token.position = stretchBaseMap[colorIdx] + 1;
  token.steps_taken = 52;
  gameState.last_action = `[CHEAT] Teleported ${token.color} Pawn #${token.id} to home stretch (Pos ${token.position})`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function teleportSelectedTokenToFinish(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token) return;

  token.position = 999;
  token.steps_taken = 57;
  gameState.last_action = `[CHEAT] Teleported ${token.color} Pawn #${token.id} to finish (999)`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function teleportSelectedTokenToBase(tokenId: number | null = getTargetDebugTokenId()) {
  if (!isDebugModeEnabled || tokenId === null) return;
  const token = gameState.tokens.find(t => t.id === tokenId);
  if (!token) return;

  token.position = -1;
  token.steps_taken = 0;
  gameState.last_action = `[CHEAT] Reset ${token.color} Pawn #${token.id} to home base (-1)`;

  sounds.playStep();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function forceSetDiceRoll(val: number) {
  if (!isDebugModeEnabled || gameState.winner !== null) return;

  gameState.dice_roll = val;
  validTokenIds = getValidMoveTokenIds(gameState);
  engine.triggerDiceAnimation(val);

  gameState.last_action = `[CHEAT] Force set dice roll to ${val}`;
  sounds.playClick();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function setupInstantHitCheat() {
  if (!isDebugModeEnabled) return;

  const currentTurn = gameState.current_turn;
  const startTrackMap = [0, 13, 26, 39];

  // 1. Find hitter pawn
  let hitterPawn = gameState.tokens.find(t => t.id === selectedDebugTokenId && Math.floor(t.id / 4) === currentTurn);
  if (!hitterPawn) {
    hitterPawn = gameState.tokens.find(t => Math.floor(t.id / 4) === currentTurn);
  }

  if (!hitterPawn) return;

  // 2. Find opponent pawn on track
  let opponentPawn = gameState.tokens.find(t => Math.floor(t.id / 4) !== currentTurn && t.position >= 0 && t.position < 52);

  // If no opponent pawn is on track, spawn an opponent pawn onto track
  if (!opponentPawn) {
    opponentPawn = gameState.tokens.find(t => Math.floor(t.id / 4) !== currentTurn);
    if (opponentPawn) {
      const oppColorIdx = Math.floor(opponentPawn.id / 4);
      opponentPawn.position = (startTrackMap[oppColorIdx] + 5) % 52;
      opponentPawn.steps_taken = 6;
    }
  }

  if (!opponentPawn) return;

  // 3. Place hitter pawn 1 step behind opponent pawn
  const targetTrackPos = opponentPawn.position;
  const newHitterPos = (targetTrackPos - 1 + 52) % 52;

  const hitterStartTrack = startTrackMap[currentTurn];
  let newSteps = ((newHitterPos - hitterStartTrack + 52) % 52) + 1;
  if (newSteps <= 0) newSteps = 1;

  hitterPawn.position = newHitterPos;
  hitterPawn.steps_taken = newSteps;

  // 4. Force dice roll to 1
  gameState.dice_roll = 1;
  validTokenIds = getValidMoveTokenIds(gameState);

  selectedDebugTokenId = hitterPawn.id;
  engine.selectedDebugTokenId = hitterPawn.id;

  gameState.last_action = `[CHEAT] Instant Hit Ready! ${hitterPawn.color} Pawn #${hitterPawn.id} placed 1 tile behind ${opponentPawn.color} Pawn #${opponentPawn.id}. Click pawn to HIT!`;
  sounds.playClick();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function setTurnTo(turnIdx: number) {
  if (!isDebugModeEnabled) return;
  const turnNames = ['Red', 'Green', 'Yellow', 'Blue'];

  gameState.current_turn = turnIdx % gameState.num_players;
  gameState.dice_roll = 0;
  validTokenIds = [];

  gameState.last_action = `[CHEAT] Turn changed to ${turnNames[gameState.current_turn]}`;
  sounds.playClick();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function skipTurn() {
  if (!isDebugModeEnabled) return;
  const nextTurn = (gameState.current_turn + 1) % gameState.num_players;
  setTurnTo(nextTurn);
}

function handlePawnClick(tokenId: number, stackTokenIds: number[] = [tokenId]) {
  resetIdleTimer();

  // If any token in the clicked stack belongs to validTokenIds for the active turn, prioritize moving that token!
  let targetTokenId = tokenId;
  const validInStack = stackTokenIds.find(id => validTokenIds.includes(id));
  if (validInStack !== undefined) {
    targetTokenId = validInStack;
  }

  if (gameState.dice_roll > 0 && gameState.winner === null && validTokenIds.includes(targetTokenId)) {
    const oldTokens = gameState.tokens.map(t => ({ color_idx: Math.floor(t.id / 4), position: t.position }));
    const hitterColorIdx = gameState.current_turn;

    gameState = applyMoveToken(gameState, targetTokenId);
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
  if (gameState.is_team_mode) {
    const teamLabel = gameState.current_turn % 2 === 0 ? "Team A (Red & Yellow)" : "Team B (Green & Blue)";
    turnBadge.textContent = `${currentTurnColor}'s Turn [${teamLabel}]`;
  } else {
    turnBadge.textContent = `${currentTurnColor}'s Turn`;
  }
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
    if (gameState.is_team_mode) {
      const winningTeamName = gameState.winner % 2 === 0 ? "RED & YELLOW (Team A)" : "GREEN & BLUE (Team B)";
      winnerText.textContent = `🎉 TEAM ${winningTeamName} HAS WON THE MATCH!`;
    } else {
      winnerText.textContent = `🎉 PLAYER ${turnColors[gameState.winner]} HAS WON!`;
    }
    winnerModal.style.display = 'flex';
  }

  // Update Developer Debug Status Banner
  const debugPawnLabel = document.getElementById('debug-selected-pawn-label');
  const debugPawnPosInfo = document.getElementById('debug-pawn-pos-info');
  if (debugPawnLabel && debugPawnPosInfo) {
    if (selectedDebugTokenId !== null) {
      const token = gameState.tokens.find(t => t.id === selectedDebugTokenId);
      if (token) {
        debugPawnLabel.textContent = `${token.color} Pawn #${token.id}`;
        debugPawnPosInfo.textContent = `Pos: ${token.position} (Steps: ${token.steps_taken})`;
      }
    } else {
      debugPawnLabel.textContent = 'None (Click any 3D piece on board)';
      debugPawnPosInfo.textContent = 'Position: -';
    }
  }

  // Update Debug HUD 2v2 Team Mode Toggle Checkbox
  const debugTeamModeToggle = document.getElementById('debug-team-mode-toggle') as HTMLInputElement;
  if (debugTeamModeToggle) {
    debugTeamModeToggle.checked = !!gameState.is_team_mode;
  }

  // Update Header Cheats Button display
  const btnOpenDebug = document.getElementById('btn-open-debug');
  if (btnOpenDebug) {
    btnOpenDebug.style.display = isDebugModeEnabled ? 'flex' : 'none';
  }
}

function setupUIControls() {
  document.getElementById('btn-roll')?.addEventListener('click', handleRollDice);
}

function setupDebugControls() {
  const debugModal = document.getElementById('debug-panel-modal')!;
  const btnOpenDebug = document.getElementById('btn-open-debug')!;
  const btnOpenDebugFromConfig = document.getElementById('btn-open-debug-from-config')!;
  const btnCloseDebug = document.getElementById('btn-close-debug')!;

  const configDebugToggle = document.getElementById('config-debug-toggle') as HTMLInputElement;
  const debugEnableToggle = document.getElementById('debug-enable-toggle') as HTMLInputElement;
  const debugTeamModeToggle = document.getElementById('debug-team-mode-toggle') as HTMLInputElement;

  if (debugTeamModeToggle) {
    debugTeamModeToggle.addEventListener('change', () => {
      sounds.playClick();
      gameState.is_team_mode = debugTeamModeToggle.checked;
      validTokenIds = getValidMoveTokenIds(gameState);
      updateUI();
    });
  }

  const syncDebugToggles = (enabled: boolean) => {
    isDebugModeEnabled = enabled;
    localStorage.setItem('ludo_debug_mode', enabled ? 'true' : 'false');
    if (configDebugToggle) configDebugToggle.checked = enabled;
    if (debugEnableToggle) debugEnableToggle.checked = enabled;
    if (btnOpenDebug) btnOpenDebug.style.display = enabled ? 'flex' : 'none';
  };

  if (configDebugToggle) {
    configDebugToggle.checked = isDebugModeEnabled;
    configDebugToggle.addEventListener('change', () => {
      sounds.playClick();
      syncDebugToggles(configDebugToggle.checked);
    });
  }

  if (debugEnableToggle) {
    debugEnableToggle.checked = isDebugModeEnabled;
    debugEnableToggle.addEventListener('change', () => {
      sounds.playClick();
      syncDebugToggles(debugEnableToggle.checked);
    });
  }

  const openDebugModal = () => {
    if (!isDebugModeEnabled) return;
    sounds.playClick();
    debugModal.style.display = 'flex';
  };

  const closeDebugModal = () => {
    sounds.playClick();
    debugModal.style.display = 'none';
  };

  btnOpenDebug?.addEventListener('click', openDebugModal);
  btnOpenDebugFromConfig?.addEventListener('click', () => {
    const configModal = document.getElementById('config-modal');
    if (configModal) configModal.style.display = 'none';
    openDebugModal();
  });
  btnCloseDebug?.addEventListener('click', closeDebugModal);

  debugModal?.addEventListener('click', (e) => {
    if (e.target === debugModal) {
      debugModal.style.display = 'none';
    }
  });

  // Action Buttons
  document.getElementById('btn-cheat-setup-hit')?.addEventListener('click', () => setupInstantHitCheat());
  document.getElementById('btn-cheat-trigger-emojis')?.addEventListener('click', () => {
    sounds.playCapture();
    engine.triggerCaptureEmojis(gameState.current_turn, (gameState.current_turn + 1) % gameState.num_players);
  });
  document.getElementById('btn-cheat-step-fwd')?.addEventListener('click', () => moveSelectedTokenDebugForward());
  document.getElementById('btn-cheat-step-back')?.addEventListener('click', () => moveSelectedTokenDebugBackward());
  document.getElementById('btn-cheat-to-track')?.addEventListener('click', () => teleportSelectedTokenToTrack());
  document.getElementById('btn-cheat-to-stretch')?.addEventListener('click', () => teleportSelectedTokenToStretch());
  document.getElementById('btn-cheat-to-finish')?.addEventListener('click', () => teleportSelectedTokenToFinish());
  document.getElementById('btn-cheat-to-base')?.addEventListener('click', () => teleportSelectedTokenToBase());
  document.getElementById('btn-cheat-next-turn')?.addEventListener('click', () => skipTurn());

  // Dice Cheat Buttons (1 to 6)
  const diceBtns = document.querySelectorAll<HTMLButtonElement>('.btn-dice-cheat');
  diceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val || '1', 10);
      forceSetDiceRoll(val);
    });
  });

  // Turn Cheat Buttons (Red, Green, Yellow, Blue)
  const turnBtns = document.querySelectorAll<HTMLButtonElement>('.btn-turn-cheat');
  turnBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const turnIdx = parseInt(btn.dataset.turn || '0', 10);
      setTurnTo(turnIdx);
    });
  });

  // Hotkey keyboard listener (F2, ~, 1..6, ArrowRight, ArrowLeft, H, T, F, R, Tab)
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    // Toggle Debug HUD: F2 or ` (Backtick / Tilde)
    if (event.key === 'F2' || event.key === '`' || event.key === '~') {
      event.preventDefault();
      if (debugModal.style.display === 'flex') {
        closeDebugModal();
      } else {
        openDebugModal();
      }
      return;
    }

    if (!isDebugModeEnabled) return;

    // Dice Force Roll 1..6
    if (/^[1-6]$/.test(event.key)) {
      event.preventDefault();
      forceSetDiceRoll(parseInt(event.key, 10));
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveSelectedTokenDebugForward();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelectedTokenDebugBackward();
        break;
      case 'h':
      case 'H':
        event.preventDefault();
        setupInstantHitCheat();
        break;
      case 't':
      case 'T':
        event.preventDefault();
        teleportSelectedTokenToTrack();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        teleportSelectedTokenToFinish();
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        teleportSelectedTokenToBase();
        break;
      case 'Tab':
        event.preventDefault();
        skipTurn();
        break;
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

