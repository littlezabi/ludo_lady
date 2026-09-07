/**
 * Ludo Lady - Game Logic
 * Pure game logic functions. Runs on host's browser.
 */

(function() {
  const C = window.CONSTANTS;

  /**
   * Creates the initial game state.
   * @param {Array<{id: string, name: string, colorIndex: number}>} players
   * @returns {Object} The initial game state.
   */
  function createInitialGameState(players) {
    const statePlayers = players.map(p => ({
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      tokens: [
        { state: C.TOKEN_STATES.HOME, position: -1 },
        { state: C.TOKEN_STATES.HOME, position: -1 },
        { state: C.TOKEN_STATES.HOME, position: -1 },
        { state: C.TOKEN_STATES.HOME, position: -1 }
      ]
    }));

    return {
      players: statePlayers,
      currentPlayerIndex: 0,
      diceValue: null,
      consecutiveSixes: 0,
      gamePhase: 'playing',
      winner: null,
      turnPhase: 'roll'
    };
  }

  /**
   * Rolls a dice.
   * @returns {number} Random value between 1 and 6.
   */
  function rollDice() {
    return Math.floor(Math.random() * 6) + 1;
  }

  /**
   * Checks if a main path index is a safe zone.
   * @param {number} mainPathIndex
   * @returns {boolean} True if safe.
   */
  function isPositionSafe(mainPathIndex) {
    return C.SAFE_ZONE_INDICES.includes(mainPathIndex);
  }

  /**
   * Converts a player-relative position to an absolute main path index.
   * @param {number} playerIndex
   * @param {number} playerPathPosition
   * @returns {number} The absolute main path index, or -1 if in home column.
   */
  function getMainPathIndex(playerIndex, playerPathPosition) {
    if (playerPathPosition >= 52) return -1;
    const startIndex = C.PLAYER_START_INDICES[playerIndex];
    return (startIndex + playerPathPosition) % 52;
  }

  /**
   * Gets the grid position [row, col] for a token.
   * @param {number} playerIndex
   * @param {Object} token
   * @returns {Array<number>|null} The grid position [row, col] or null.
   */
  function getTokenGridPosition(playerIndex, token) {
    if (token.state === C.TOKEN_STATES.HOME) return null;
    if (token.state === C.TOKEN_STATES.FINISHED) return null;
    return C.PLAYER_PATHS[playerIndex][token.position];
  }

  /**
   * Finds an opponent token at the given grid coordinates.
   * @param {Object} gameState
   * @param {number} row
   * @param {number} col
   * @param {number} excludePlayerIndex
   * @returns {Object|null} {playerIndex, tokenIndex} or null.
   */
  function findTokenAtPosition(gameState, row, col, excludePlayerIndex) {
    for (let pIdx = 0; pIdx < gameState.players.length; pIdx++) {
      if (pIdx === excludePlayerIndex) continue;
      const player = gameState.players[pIdx];
      for (let tIdx = 0; tIdx < player.tokens.length; tIdx++) {
        const token = player.tokens[tIdx];
        const pos = getTokenGridPosition(pIdx, token);
        if (pos && pos[0] === row && pos[1] === col) {
          return { playerIndex: pIdx, tokenIndex: tIdx };
        }
      }
    }
    return null;
  }

  /**
   * Gets all valid moves for the current player given a dice roll.
   * @param {Object} gameState
   * @param {number} diceValue
   * @returns {Array<Object>} Array of valid moves.
   */
  function getValidMoves(gameState, diceValue) {
    const pIdx = gameState.currentPlayerIndex;
    const player = gameState.players[pIdx];
    const validMoves = [];

    for (let tIdx = 0; tIdx < player.tokens.length; tIdx++) {
      const token = player.tokens[tIdx];

      if (token.state === C.TOKEN_STATES.HOME) {
        if (diceValue === 6) {
          const toPosition = 0;
          const ownTokensThere = player.tokens.some((t, i) => i !== tIdx && t.state === C.TOKEN_STATES.ACTIVE && t.position === toPosition);
          if (!ownTokensThere) {
            validMoves.push({
              tokenIndex: tIdx,
              fromPosition: -1,
              toPosition: toPosition,
              isCapture: false,
              isFinish: false,
              isEnterBoard: true
            });
          }
        }
      } else if (token.state === C.TOKEN_STATES.ACTIVE) {
        const toPosition = token.position + diceValue;
        if (toPosition <= C.FINISHED_POSITION) {
          const ownTokensThere = player.tokens.some((t, i) => i !== tIdx && t.state === C.TOKEN_STATES.ACTIVE && t.position === toPosition);
          if (!ownTokensThere) {
            const isFinish = (toPosition === C.FINISHED_POSITION);
            let isCapture = false;
            
            if (!isFinish) {
              const targetGridPos = C.PLAYER_PATHS[pIdx][toPosition];
              const opponent = findTokenAtPosition(gameState, targetGridPos[0], targetGridPos[1], pIdx);
              if (opponent) {
                const absIndex = getMainPathIndex(pIdx, toPosition);
                if (absIndex !== -1 && !isPositionSafe(absIndex)) {
                  isCapture = true;
                }
              }
            }

            validMoves.push({
              tokenIndex: tIdx,
              fromPosition: token.position,
              toPosition: toPosition,
              isCapture: isCapture,
              isFinish: isFinish,
              isEnterBoard: false
            });
          }
        }
      }
    }

    return validMoves;
  }

  /**
   * Applies a move and returns new state and events.
   * @param {Object} gameState
   * @param {number} tokenIndex
   * @returns {Object} {newState, events}
   */
  function applyMove(gameState, tokenIndex) {
    const newState = JSON.parse(JSON.stringify(gameState));
    const pIdx = newState.currentPlayerIndex;
    const player = newState.players[pIdx];
    const diceValue = newState.diceValue;
    const events = [];

    const validMoves = getValidMoves(newState, diceValue);
    const move = validMoves.find(m => m.tokenIndex === tokenIndex);

    if (!move) return { newState, events };

    const token = player.tokens[tokenIndex];

    if (move.isEnterBoard) {
      token.state = C.TOKEN_STATES.ACTIVE;
      token.position = move.toPosition;
      events.push({ type: 'move', playerIndex: pIdx, tokenIndex: tokenIndex, toPosition: token.position });
    } else {
      token.position = move.toPosition;
      if (move.isFinish) {
        token.state = C.TOKEN_STATES.FINISHED;
        events.push({ type: 'finish', playerIndex: pIdx, tokenIndex: tokenIndex });
      } else {
        events.push({ type: 'move', playerIndex: pIdx, tokenIndex: tokenIndex, toPosition: token.position });
      }

      if (move.isCapture) {
        const targetGridPos = C.PLAYER_PATHS[pIdx][token.position];
        const opponent = findTokenAtPosition(newState, targetGridPos[0], targetGridPos[1], pIdx);
        if (opponent) {
          const oppToken = newState.players[opponent.playerIndex].tokens[opponent.tokenIndex];
          oppToken.state = C.TOKEN_STATES.HOME;
          oppToken.position = -1;
          events.push({ type: 'capture', playerIndex: pIdx, tokenIndex: tokenIndex, capturedPlayerIndex: opponent.playerIndex, capturedTokenIndex: opponent.tokenIndex });
        }
      }
    }

    const finishedTokens = player.tokens.filter(t => t.state === C.TOKEN_STATES.FINISHED).length;
    if (finishedTokens === 4) {
      newState.winner = pIdx;
      newState.gamePhase = 'ended';
      events.push({ type: 'win', playerIndex: pIdx });
    }

    return { newState, events };
  }

  /**
   * Advances the turn.
   * @param {Object} gameState
   * @returns {Object} The new game state.
   */
  function advanceTurn(gameState) {
    const newState = JSON.parse(JSON.stringify(gameState));
    
    if (newState.diceValue === 6 && newState.consecutiveSixes < C.MAX_CONSECUTIVE_SIXES) {
      newState.turnPhase = 'roll';
    } else {
      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
      newState.consecutiveSixes = 0;
      newState.turnPhase = 'roll';
    }
    newState.diceValue = null;
    return newState;
  }

  /**
   * Checks if the game is over.
   * @param {Object} gameState
   * @returns {boolean} True if over.
   */
  function checkGameOver(gameState) {
    return gameState.players.some(p => p.tokens.every(t => t.state === C.TOKEN_STATES.FINISHED));
  }

  window.GameLogic = {
    createInitialGameState,
    rollDice,
    getValidMoves,
    applyMove,
    advanceTurn,
    isPositionSafe,
    getMainPathIndex,
    findTokenAtPosition,
    getTokenGridPosition,
    checkGameOver
  };
})();
