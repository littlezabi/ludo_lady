import init, { create_game, roll_dice, get_valid_tokens, move_token } from './wasm_pkg/rust_core.js';

export interface TokenState {
  id: number;
  color: 'Red' | 'Green' | 'Yellow' | 'Blue';
  position: number; // -1: Base, 0..51: Track, 100..105: Red, 200..205: Green, 300..305: Yellow, 400..405: Blue, 999: Finished
  steps_taken: number;
}

export interface GameState {
  num_players: number;
  current_turn: number; // 0..3
  dice_roll: number;
  consecutive_sixes: number;
  winner: number | null;
  tokens: TokenState[];
  last_action: String;
}

let isInitialized = false;

export async function initWasmModule(): Promise<void> {
  if (!isInitialized) {
    await init();
    isInitialized = true;
  }
}

export function newGame(numPlayers: number = 4): GameState {
  const jsonStr = create_game(numPlayers);
  return JSON.parse(jsonStr);
}

export function rollDiceState(currentState: GameState): GameState {
  const inputStr = JSON.stringify(currentState);
  const resultStr = roll_dice(inputStr);
  return JSON.parse(resultStr);
}

export function getValidMoveTokenIds(currentState: GameState): number[] {
  const inputStr = JSON.stringify(currentState);
  const resultStr = get_valid_tokens(inputStr);
  return JSON.parse(resultStr);
}

export function applyMoveToken(currentState: GameState, tokenId: number): GameState {
  const inputStr = JSON.stringify(currentState);
  const resultStr = move_token(inputStr, tokenId);
  return JSON.parse(resultStr);
}
