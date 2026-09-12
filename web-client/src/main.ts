import { initWasmModule, newGame, rollDiceState, getValidMoveTokenIds, applyMoveToken, GameState } from './wasmLoader';
import { Ludo3DEngine } from './engine';
import { joinRoom, broadcastGameState, generateRoomCode } from './network';
import { sounds } from './soundEffects';

let engine: Ludo3DEngine;
let gameState: GameState;
let validTokenIds: number[] = [];
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
      gameState = remoteState;
      validTokenIds = getValidMoveTokenIds(gameState);
      updateUI();
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
      gameState = remoteState;
      validTokenIds = getValidMoveTokenIds(gameState);
      updateUI();
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

function handlePawnClick(tokenId: number) {
  if (gameState.dice_roll === 0 || gameState.winner !== null) return;
  if (!validTokenIds.includes(tokenId)) return;

  gameState = applyMoveToken(gameState, tokenId);
  validTokenIds = [];

  // Check audio triggers
  if (gameState.last_action.includes("captured")) {
    sounds.playCapture();
  }

  if (gameState.winner !== null) {
    sounds.playWinFanfare();
  }

  if (roomCode) {
    broadcastGameState(gameState);
  }

  updateUI();
}

function updateUI() {
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
}

window.addEventListener('DOMContentLoaded', bootstrap);
