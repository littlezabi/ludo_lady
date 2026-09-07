/**
 * Ludo Lady - Constants
 * Defines ALL board layout data, paths, colors, and game parameters.
 * Single source of truth for the entire game.
 */

(function() {
  // --- GRID & PLAYERS ---
  const GRID_SIZE = 15;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const FINISHED_POSITION = 58;
  const FULL_PATH_LENGTH = 58;
  const MAX_CONSECUTIVE_SIXES = 3;

  // --- MAIN PATH (52 cells clockwise) ---
  const MAIN_PATH = [
    // Top arm right column, going DOWN (0-5)
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
    // Turn RIGHT into right arm top row (6-11)
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
    // Right edge turn DOWN (12)
    [7,14],
    // Right arm bottom row, going LEFT (13-18)
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
    // Turn DOWN into bottom arm right col (19-24)
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
    // Bottom edge turn LEFT (25)
    [14,7],
    // Bottom arm left col, going UP (26-31)
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
    // Turn LEFT into left arm bottom row (32-37)
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
    // Left edge turn UP (38)
    [7,0],
    // Left arm top row, going RIGHT (39-44)
    [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],
    // Turn UP into top arm left col, going UP (45-50)
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
    // Top edge turn RIGHT (51)
    [0,7]
  ];

  // --- PLAYER START & HOME ENTRIES ---
  // Players indexed 0-3: Red (0), Green (1), Yellow (2), Blue (3)
  const PLAYER_START_INDICES = [40, 1, 14, 27];
  const HOME_ENTRY_INDICES = [39, 0, 13, 26];

  // Home columns (6 cells each leading to center)
  const HOME_COLUMNS = [
    // Red: row 7 cols 1→6
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    // Green: col 7 rows 1→6
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    // Yellow: row 7 cols 13→8
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    // Blue: col 7 rows 13→8
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
  ];

  // Build PLAYER_PATHS (58 cells per player: 52 main path + 6 home column)
  const PLAYER_PATHS = [];
  for (let p = 0; p < 4; p++) {
    const path = [];
    const startIndex = PLAYER_START_INDICES[p];
    for (let i = 0; i < 52; i++) {
      path.push(MAIN_PATH[(startIndex + i) % 52]);
    }
    path.push(...HOME_COLUMNS[p]);
    PLAYER_PATHS.push(path);
  }

  // Home base bounds (6x6 corners)
  const HOME_BASE_BOUNDS = [
    { row: 0, col: 0, width: 6, height: 6 }, // Red
    { row: 0, col: 9, width: 6, height: 6 }, // Green
    { row: 9, col: 9, width: 6, height: 6 }, // Yellow
    { row: 9, col: 0, width: 6, height: 6 }  // Blue
  ];

  // Home base token positions (2x2 arrangement inside base)
  const HOME_BASE_TOKEN_POSITIONS = [
    [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],      // Red
    [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],   // Green
    [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],// Yellow
    [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]]     // Blue
  ];

  // Display colors
  const PLAYER_COLOR_NAMES = ['red', 'green', 'yellow', 'blue'];
  const PLAYER_DISPLAY_COLORS = {
    red:    { primary: '#E74C3C', light: '#FF6B6B', dark: '#C0392B', glow: 'rgba(231,76,60,0.6)' },
    green:  { primary: '#27AE60', light: '#6BCB77', dark: '#1E8449', glow: 'rgba(39,174,96,0.6)' },
    yellow: { primary: '#F1C40F', light: '#FFD93D', dark: '#D4AC0D', glow: 'rgba(241,196,15,0.6)' },
    blue:   { primary: '#2980B9', light: '#74B9FF', dark: '#1F618D', glow: 'rgba(41,128,185,0.6)' }
  };
  const PLAYER_COLORS = [
    PLAYER_DISPLAY_COLORS.red,
    PLAYER_DISPLAY_COLORS.green,
    PLAYER_DISPLAY_COLORS.yellow,
    PLAYER_DISPLAY_COLORS.blue
  ];

  // Safe zones & stars
  const SAFE_ZONE_INDICES = [1, 9, 14, 22, 27, 35, 40, 48];
  const STAR_CELL_INDICES = [9, 22, 35, 48];

  // Token states
  const TOKEN_STATES = {
    HOME: 'home',
    ACTIVE: 'active',
    FINISHED: 'finished'
  };

  // P2P Message types
  const MSG = {
    JOIN_REQUEST: 'join-request',
    JOIN_ACCEPTED: 'join-accepted',
    JOIN_REJECTED: 'join-rejected',
    PLAYER_JOINED: 'player-joined',
    PLAYER_LEFT: 'player-left',
    START_GAME: 'start-game',
    GAME_STARTED: 'game-started',
    YOUR_TURN: 'your-turn',
    ROLL_DICE: 'roll-dice',
    DICE_ROLLED: 'dice-rolled',
    MOVE_TOKEN: 'move-token',
    TOKEN_MOVED: 'token-moved',
    TOKEN_CAPTURED: 'token-captured',
    TOKEN_FINISHED: 'token-finished',
    EXTRA_TURN: 'extra-turn',
    TURN_FORFEITED: 'turn-forfeited',
    NO_VALID_MOVES: 'no-valid-moves',
    PLAYER_WON: 'player-won',
    GAME_STATE_SYNC: 'game-state-sync'
  };

  window.CONSTANTS = {
    GRID_SIZE,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAIN_PATH,
    PLAYER_START_INDICES,
    HOME_ENTRY_INDICES,
    HOME_COLUMNS,
    PLAYER_PATHS,
    HOME_BASE_BOUNDS,
    HOME_BASES: HOME_BASE_BOUNDS,
    HOME_BASE_TOKEN_POSITIONS,
    HOME_TOKEN_POSITIONS: HOME_BASE_TOKEN_POSITIONS,
    PLAYER_COLOR_NAMES,
    PLAYER_DISPLAY_COLORS,
    PLAYER_COLORS,
    SAFE_ZONE_INDICES,
    STAR_CELL_INDICES,
    TOKEN_STATES,
    TOKEN_STATE: TOKEN_STATES,
    FINISHED_POSITION,
    FULL_PATH_LENGTH,
    MAX_CONSECUTIVE_SIXES,
    MSG
  };
})();
