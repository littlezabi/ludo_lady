import { initWasmModule, newGame, rollDiceState, getValidMoveTokenIds, applyMoveToken, GameState } from './wasmLoader';
import { Ludo3DEngine } from './engine';
import { joinRoom, broadcastGameState } from './network';
import { sounds } from './soundEffects';

let engine: Ludo3DEngine;
let gameState: GameState;
let validTokenIds: number[] = [];
let roomCode: string | null = null;

async function bootstrap() {
  const loadingOverlay = document.getElementById('loading-overlay')!;
  const canvasContainer = document.getElementById('canvas-container')!;

  try {
    // 1. Initialize WASM Engine
    await initWasmModule();
    console.log("WASM Core Logic loaded.");

    // 2. Initialize 3D Viewport
    engine = new Ludo3DEngine(canvasContainer);

    // 3. Initialize New 4-Player Game State
    gameState = newGame(4);
    updateUI();

    // 4. Bind 3D Pawn Touch/Click
    engine.setOnTokenClicked((tokenId: number) => {
      handlePawnClick(tokenId);
    });

    // 5. Setup UI Event Listeners
    setupUIControls();

    // Hide Loading Screen
    loadingOverlay.style.opacity = '0';
    setTimeout(() => loadingOverlay.remove(), 400);

  } catch (err) {
    console.error("Initialization error:", err);
    loadingOverlay.innerHTML = `<div style="color:#ef4444; padding:2rem;">Failed to load WASM engine module: ${err}</div>`;
  }
}

function handleRollDice() {
  if (gameState.winner !== null) return;
  if (gameState.dice_roll > 0 && validTokenIds.length > 0) return; // Must move first

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

  const prevState = { ...gameState };
  gameState = applyMoveToken(gameState, tokenId);
  validTokenIds = [];

  // Check if capture occurred
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

  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    const num = parseInt((document.getElementById('num-players-select') as HTMLSelectElement).value);
    gameState = newGame(num);
    validTokenIds = [];
    document.getElementById('winner-modal')!.style.display = 'none';
    updateUI();
  });

  // Room Join
  document.getElementById('btn-join-room')?.addEventListener('click', () => {
    const codeInput = (document.getElementById('room-code-input') as HTMLInputElement).value.trim();
    if (codeInput) {
      roomCode = codeInput;
      joinRoom(roomCode, (remoteState) => {
        gameState = remoteState;
        validTokenIds = getValidMoveTokenIds(gameState);
        updateUI();
      });
      alert(`Joined Room ${roomCode}! Sync active.`);
    }
  });
}

window.addEventListener('DOMContentLoaded', bootstrap);
