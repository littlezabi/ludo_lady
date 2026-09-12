import { initWasmModule, newGame, newGameVsComputer, rollDiceState, getValidMoveTokenIds, getBestAIMoveTokenId, applyMoveToken, GameState } from './wasmLoader';
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
let customPlayerNames: string[] = ["Player 1", "Player 2", "Player 3", "Player 4"];

let currentMatchConfig = {
  isVsComputer: false,
  numPlayers: 4,
  isTeamMode: false,
  computerCount: 3
};

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

function loadCustomPlayerNames() {
  for (let i = 0; i < 4; i++) {
    const input = document.getElementById(`input-player-name-${i}`) as HTMLInputElement;
    if (input && input.value.trim()) {
      customPlayerNames[i] = input.value.trim();
    } else if (!customPlayerNames[i]) {
      customPlayerNames[i] = `Player ${i + 1}`;
    }
  }
  localStorage.setItem('ludo_player_names', JSON.stringify(customPlayerNames));
}

function restoreCustomPlayerNamesInput() {
  const saved = localStorage.getItem('ludo_player_names');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length >= 4) {
        customPlayerNames = parsed;
        for (let i = 0; i < 4; i++) {
          const input = document.getElementById(`input-player-name-${i}`) as HTMLInputElement;
          if (input) input.value = parsed[i] || `Player ${i + 1}`;
        }
      }
    } catch {}
  }
}

function getPlayerColorInfo(state: GameState, playerIdx: number) {
  const colorHexes = ['#ef4444', '#22c55e', '#eab308', '#3b82f6'];
  const colorBaseNames = ['Red', 'Green', 'Yellow', 'Blue'];
  let colorIdx = playerIdx;

  if (state.num_players === 2) {
    colorIdx = playerIdx === 0 ? 0 : 2;
  } else if (state.num_players === 3) {
    colorIdx = playerIdx % 3;
  } else {
    colorIdx = playerIdx % 4;
  }

  const customName = customPlayerNames[playerIdx] || `Player ${playerIdx + 1}`;
  const hex = colorHexes[colorIdx] || '#ef4444';

  return { name: customName, colorName: colorBaseNames[colorIdx], hex };
}

function applyPersistentCamera() {
  if (!engine) return;
  const savedCameraView = (localStorage.getItem('ludo_camera_mode') as CameraViewMode) || 'top';
  const savedPlayerColor = parseInt(localStorage.getItem('ludo_player_color') || '0', 10);
  engine.setCameraViewMode(savedCameraView, savedPlayerColor);
}

function checkIdleTimer() {
  if (!gameState || gameState.is_game_over || gameState.winner !== null) {
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
      const turnInfo = getPlayerColorInfo(gameState, gameState.current_turn);
      gameState.last_action = `[IDLE] ${turnInfo.name} is sleeping... Zzz 😴`;
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

    // 3. Restore Saved Player Names
    restoreCustomPlayerNamesInput();

    // 4. Apply Persistent Camera Setting (Default Top View, base_value = 19)
    applyPersistentCamera();

    // 5. Initialize Default 4-Player Local Game State
    gameState = newGame(4);
    updateUI();

    // 6. Bind 3D Pawn Click/Touch
    engine.setOnTokenClicked((tokenId: number, stackTokenIds: number[]) => {
      handlePawnClick(tokenId, stackTokenIds);
    });

    // 7. Setup Menu, Config, and Debug Controls
    setupMenuControls();
    setupConfigControls();
    setupDebugControls();
    setupUIControls();

    // 8. Start 10-Second Idle Detector Interval
    setInterval(checkIdleTimer, 500);

    // 9. Check URL query params for direct room join link (?room=123456)
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
let isMatchActive = false;

function setupMenuControls() {
  const mainMenuOverlay = document.getElementById('main-menu-overlay')!;
  const btnCloseMainMenu = document.getElementById('btn-close-main-menu')!;
  const tabCreate = document.getElementById('tab-create')!;
  const tabJoin = document.getElementById('tab-join')!;
  const tabLocal = document.getElementById('tab-local')!;
  const tabComputer = document.getElementById('tab-computer')!;

  const contentCreate = document.getElementById('content-create')!;
  const contentJoin = document.getElementById('content-join')!;
  const contentLocal = document.getElementById('content-local')!;
  const contentComputer = document.getElementById('content-computer')!;

  const generatedCodeEl = document.getElementById('generated-room-code')!;
  const btnCopy = document.getElementById('btn-copy-generated')!;

  // Close / Resume Menu Button Handler
  btnCloseMainMenu?.addEventListener('click', () => {
    sounds.playClick();
    mainMenuOverlay.classList.add('hidden');
  });

  const markGameActive = () => {
    isMatchActive = true;
    if (btnCloseMainMenu) btnCloseMainMenu.style.display = 'flex';
  };

  // Game Mode Selector Sync (Classic 4P vs 2v2 Team Mode) & Persistence
  const savedGameMode = (localStorage.getItem('ludo_match_type') as 'classic' | 'team') || 'classic';
  selectedGameMode = savedGameMode;

  const modeBtns = document.querySelectorAll<HTMLButtonElement>('.mode-select-btn');
  modeBtns.forEach(b => {
    if (b.dataset.mode === selectedGameMode) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      const mode = (btn.dataset.mode as 'classic' | 'team') || 'classic';
      selectedGameMode = mode;
      localStorage.setItem('ludo_match_type', mode);
      modeBtns.forEach(b => {
        if (b.dataset.mode === selectedGameMode) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    });
  });

  // Load & Persist Computer Config Select
  const computerConfigSelect = document.getElementById('menu-computer-config') as HTMLSelectElement;
  if (computerConfigSelect) {
    const savedCompConfig = localStorage.getItem('ludo_computer_config') || '3';
    computerConfigSelect.value = savedCompConfig;
    computerConfigSelect.addEventListener('change', () => {
      localStorage.setItem('ludo_computer_config', computerConfigSelect.value);
    });
  }

  // Load & Persist Player Count Select
  const playerCountSelect = document.getElementById('menu-player-count') as HTMLSelectElement;
  if (playerCountSelect) {
    const savedPlayerCount = localStorage.getItem('ludo_player_count') || '4';
    playerCountSelect.value = savedPlayerCount;
    playerCountSelect.addEventListener('change', () => {
      localStorage.setItem('ludo_player_count', playerCountSelect.value);
    });
  }

  // Generate Initial Room Code
  generatedRoomCode = generateRoomCode();
  generatedCodeEl.textContent = generatedRoomCode;

  // Tab Switching Logic
  const switchTab = (activeBtn: HTMLElement, activeContent: HTMLElement) => {
    sounds.playClick();
    [tabCreate, tabJoin, tabLocal, tabComputer].forEach(btn => btn?.classList.remove('active'));
    [contentCreate, contentJoin, contentLocal, contentComputer].forEach(content => content?.classList.remove('active'));

    activeBtn.classList.add('active');
    activeContent.classList.add('active');
  };

  tabCreate.addEventListener('click', () => switchTab(tabCreate, contentCreate));
  tabJoin.addEventListener('click', () => switchTab(tabJoin, contentJoin));
  tabLocal.addEventListener('click', () => switchTab(tabLocal, contentLocal));
  tabComputer?.addEventListener('click', () => switchTab(tabComputer, contentComputer));

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
    loadCustomPlayerNames();
    const select = document.getElementById('menu-player-count') as HTMLSelectElement;
    const numPlayers = parseInt(select.value, 10);
    const isTeamMode = selectedGameMode === 'team';

    currentMatchConfig = { isVsComputer: false, numPlayers, isTeamMode, computerCount: 0 };
    roomCode = generatedRoomCode;
    gameState = newGame(numPlayers, isTeamMode);
    validTokenIds = [];

    joinRoom(roomCode, (remoteState) => {
      handleRemoteStateUpdate(remoteState);
    });

    broadcastGameState(gameState);

    updateRoomDisplay(`Room: ${roomCode} ${isTeamMode ? '(2v2 Teams)' : ''}`);
    markGameActive();
    applyPersistentCamera();
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Join Room Button
  document.getElementById('btn-submit-join-room')?.addEventListener('click', () => {
    sounds.playClick();
    loadCustomPlayerNames();
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
    markGameActive();
    applyPersistentCamera();
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Start Local Game Button
  document.getElementById('btn-start-local-game')?.addEventListener('click', () => {
    sounds.playClick();
    loadCustomPlayerNames();
    roomCode = null;
    const isTeamMode = selectedGameMode === 'team';
    gameState = newGame(4, isTeamMode);
    validTokenIds = [];

    updateRoomDisplay(isTeamMode ? "Local Match (2v2 Teams)" : "Local Match");
    markGameActive();
    applyPersistentCamera();
    mainMenuOverlay.classList.add('hidden');
    updateUI();
  });

  // Start Computer Game Button
  document.getElementById('btn-start-computer-game')?.addEventListener('click', () => {
    sounds.playClick();
    loadCustomPlayerNames();
    roomCode = null;
    const isTeamMode = selectedGameMode === 'team';
    const select = document.getElementById('menu-computer-config') as HTMLSelectElement;
    const computerCount = parseInt(select ? select.value : '3', 10);
    const numPlayers = computerCount === 1 ? 2 : 4;

    currentMatchConfig = { isVsComputer: true, numPlayers, isTeamMode, computerCount };
    gameState = newGameVsComputer(numPlayers, isTeamMode, computerCount);
    validTokenIds = [];

    const modeLabel = isTeamMode ? "vs Computer (2v2 Team)" : "vs Computer";
    updateRoomDisplay(modeLabel);
    markGameActive();
    applyPersistentCamera();
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

  document.getElementById('btn-winner-ok')?.addEventListener('click', () => {
    sounds.playClick();
    document.getElementById('winner-modal')!.style.display = 'none';
    mainMenuOverlay.classList.remove('hidden');
  });

  document.getElementById('btn-winner-restart')?.addEventListener('click', () => {
    restartCurrentGame();
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
  if (!gameState || gameState.is_game_over) return;
  if (engine && (engine.isDiceRolling || engine.isAnimating)) return;
  if (gameState.dice_roll > 0 && validTokenIds.length > 0) return; // Strict lock: must move piece first!

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
  if (!isDebugModeEnabled || gameState.is_game_over || gameState.winner !== null) return;

  gameState.dice_roll = val;
  validTokenIds = getValidMoveTokenIds(gameState);
  engine.triggerDiceAnimation(val);

  gameState.last_action = `[CHEAT] Force set dice roll to ${val}`;
  sounds.playClick();
  updateUI();

  if (roomCode) broadcastGameState(gameState);
}

function setupInstantHitCheat() {
  if (!isDebugModeEnabled || gameState.is_game_over) return;

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
  if (!isDebugModeEnabled || gameState.is_game_over) return;
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
  if (!isDebugModeEnabled || gameState.is_game_over) return;
  const nextTurn = (gameState.current_turn + 1) % gameState.num_players;
  setTurnTo(nextTurn);
}

function handlePawnClick(tokenId: number, stackTokenIds: number[] = [tokenId]) {
  resetIdleTimer();
  if (!gameState || gameState.is_game_over) return;
  if (engine && engine.isAnimating) return;

  // If any token in the clicked stack belongs to validTokenIds for the active turn, prioritize moving that token!
  let targetTokenId = tokenId;
  const validInStack = stackTokenIds.find(id => validTokenIds.includes(id));
  if (validInStack !== undefined) {
    targetTokenId = validInStack;
  }

  if (gameState.dice_roll > 0 && validTokenIds.includes(targetTokenId)) {
    const oldTokens = gameState.tokens.map(t => ({ id: t.id, color_idx: Math.floor(t.id / 4), position: t.position }));
    const hitterColorIdx = gameState.current_turn;

    gameState = applyMoveToken(gameState, targetTokenId);
    validTokenIds = [];
    selectedDebugTokenId = null;
    engine.selectedDebugTokenId = null;

    // Detect if piece reached position 999 (goal destination)
    const movedToken = gameState.tokens.find(t => t.id === targetTokenId);
    const oldMovedToken = oldTokens.find(t => t.id === targetTokenId);
    if (movedToken && oldMovedToken && oldMovedToken.position !== 999 && movedToken.position === 999) {
      engine.triggerGoalReachedAnimation(Math.floor(targetTokenId / 4));
    }

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

    if (gameState.is_game_over) {
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

  const currentTurnInfo = getPlayerColorInfo(gameState, gameState.current_turn);
  const currentTurnName = currentTurnInfo.name;
  const currentTurnHex = currentTurnInfo.hex;

  // Turn Badge
  const turnBadge = document.getElementById('turn-badge')!;
  const isBot = gameState.player_types && gameState.player_types[gameState.current_turn] === 1;
  const botLabel = isBot ? " (🤖 Bot)" : "";

  if (gameState.is_team_mode) {
    const teamLabel = gameState.current_turn % 2 === 0 ? "Team A" : "Team B";
    turnBadge.textContent = `${currentTurnName}${botLabel}'s Turn [${teamLabel}]`;
  } else {
    turnBadge.textContent = `${currentTurnName}${botLabel}'s Turn`;
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

  // Roll Button State (Strictly lock button when opponent turn, when dice is rolling/animating, when valid moves exist, or when match is complete)
  const btnRoll = document.getElementById('btn-roll') as HTMLButtonElement;
  const isOpponentTurn = isBot || (roomCode !== null && gameState.current_turn !== engine.myPlayerColor);
  const isAnimating = engine && (engine.isDiceRolling || engine.isAnimating);
  const isRollLocked = isAnimating || isOpponentTurn || (gameState.dice_roll > 0 && validTokenIds.length > 0) || !!gameState.is_game_over;

  if (btnRoll) {
    btnRoll.disabled = isRollLocked;
    if (isRollLocked) {
      btnRoll.style.opacity = '0.4';
      btnRoll.style.cursor = 'not-allowed';
    } else {
      btnRoll.style.opacity = '1.0';
      btnRoll.style.cursor = 'pointer';
    }
  }

  // Winner & Final Leaderboard Announcement Modal
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) {
    if (gameState.is_game_over) {
      renderWinnerLeaderboard();
      winnerModal.style.display = 'flex';
    } else {
      winnerModal.style.display = 'none';
    }
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

  // Auto-schedule turn pass if active player has rolled dice but has NO valid moves possible
  if (!gameState.is_game_over) {
    scheduleAutoPassIfNeeded();
    scheduleAITurnIfNeeded();
  }
}

function restartCurrentGame() {
  sounds.playClick();
  loadCustomPlayerNames();
  const winnerModal = document.getElementById('winner-modal');
  if (winnerModal) winnerModal.style.display = 'none';

  if (currentMatchConfig.isVsComputer) {
    gameState = newGameVsComputer(
      currentMatchConfig.numPlayers,
      currentMatchConfig.isTeamMode,
      currentMatchConfig.computerCount
    );
  } else {
    gameState = newGame(
      currentMatchConfig.numPlayers,
      currentMatchConfig.isTeamMode
    );
  }

  validTokenIds = [];
  selectedDebugTokenId = null;

  if (roomCode) {
    broadcastGameState(gameState);
  }

  applyPersistentCamera();
  updateUI();
}

function renderWinnerLeaderboard() {
  const listEl = document.getElementById('winner-rankings-list');
  if (!listEl || !gameState) return;

  listEl.innerHTML = '';

  const rankMedals = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place', '🏅 4th Place'];

  // Determine ranking order of players
  let rankedPlayerIndices: number[] = [];
  if (gameState.winners_rank && gameState.winners_rank.length > 0) {
    rankedPlayerIndices = [...gameState.winners_rank];
  } else if (gameState.winner !== null) {
    rankedPlayerIndices = [gameState.winner];
  }

  // Include remaining active players in order
  for (let i = 0; i < gameState.num_players; i++) {
    if (!rankedPlayerIndices.includes(i)) {
      rankedPlayerIndices.push(i);
    }
  }

  rankedPlayerIndices.forEach((pIdx, position) => {
    const colorInfo = getPlayerColorInfo(gameState, pIdx);
    const isBot = gameState.player_types && gameState.player_types[pIdx] === 1;
    const botTag = isBot ? " (🤖 Bot)" : "";

    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: rgba(15, 23, 42, 0.85);
      border: 1.5px solid ${colorInfo.hex};
      border-radius: 0.75rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      gap: 0.5rem;
      flex-wrap: wrap;
    `;

    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem; flex:1; min-width:130px;">
        <span style="font-weight:900; font-size:0.9rem; color:#f8fafc;">${rankMedals[position] || `🏅 ${position + 1}th`}</span>
        <span style="font-weight:800; color:${colorInfo.hex}; font-size:0.85rem; word-break:break-word;">${colorInfo.name}${botTag}</span>
      </div>
      <span style="font-weight:800; font-size:0.75rem; padding:0.2rem 0.5rem; border-radius:0.4rem; background:${colorInfo.hex}22; color:${colorInfo.hex}; border:1px solid ${colorInfo.hex}; white-space:nowrap;">
        ${position === 0 ? '👑 Champion' : `${position + 1}th Place`}
      </span>
    `;

    listEl.appendChild(item);
  });
}

let autoPassTimeout: any = null;

function scheduleAutoPassIfNeeded() {
  if (!gameState || gameState.is_game_over) return;

  if (gameState.dice_roll > 0 && validTokenIds.length === 0) {
    if (autoPassTimeout) return;
    autoPassTimeout = setTimeout(() => {
      autoPassTimeout = null;
      if (gameState && gameState.dice_roll > 0 && getValidMoveTokenIds(gameState).length === 0 && !gameState.is_game_over) {
        // Auto pass round: advance turn without rolling dice for next player!
        const nextTurn = (gameState.current_turn + 1) % gameState.num_players;
        gameState.current_turn = nextTurn;
        gameState.dice_roll = 0;
        validTokenIds = [];
        const nextInfo = getPlayerColorInfo(gameState, gameState.current_turn);
        gameState.last_action = `[NO MOVES] Turn passed to ${nextInfo.name}`;
        updateUI();
      }
    }, 800);
  } else {
    if (autoPassTimeout) {
      clearTimeout(autoPassTimeout);
      autoPassTimeout = null;
    }
  }
}

let aiTurnTimeout: any = null;

function scheduleAITurnIfNeeded() {
  if (!gameState || gameState.is_game_over) return;

  const currentTurn = gameState.current_turn;
  const playerTypes = gameState.player_types ?? [0, 0, 0, 0];

  if (playerTypes[currentTurn] !== 1) {
    if (aiTurnTimeout) {
      clearTimeout(aiTurnTimeout);
      aiTurnTimeout = null;
    }
    return;
  }

  if (engine && engine.isDiceRolling) {
    setTimeout(scheduleAITurnIfNeeded, 200);
    return;
  }

  if (aiTurnTimeout) return;

  if (gameState.dice_roll === 0) {
    aiTurnTimeout = setTimeout(() => {
      aiTurnTimeout = null;
      if (gameState && gameState.player_types && gameState.player_types[gameState.current_turn] === 1 && gameState.dice_roll === 0 && !gameState.is_game_over) {
        handleRollDice();
      }
    }, 600);
  } else {
    validTokenIds = getValidMoveTokenIds(gameState);

    if (validTokenIds.length > 0) {
      aiTurnTimeout = setTimeout(() => {
        aiTurnTimeout = null;
        if (gameState && gameState.player_types && gameState.player_types[gameState.current_turn] === 1 && gameState.dice_roll > 0 && !gameState.is_game_over) {
          const bestTokenId = getBestAIMoveTokenId(gameState);
          const targetId = (bestTokenId !== null && validTokenIds.includes(bestTokenId)) ? bestTokenId : validTokenIds[0];
          handlePawnClick(targetId);
        }
      }, 750);
    } else {
      aiTurnTimeout = setTimeout(() => {
        aiTurnTimeout = null;
        if (gameState && gameState.player_types && gameState.player_types[gameState.current_turn] === 1 && !gameState.is_game_over) {
          handleRollDice();
        }
      }, 750);
    }
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
  const savedCameraView = (localStorage.getItem('ludo_camera_mode') as CameraViewMode) || 'top';
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

