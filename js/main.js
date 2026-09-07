/**
 * Ludo Lady - Main Application Controller
 */

(function() {
  class LudoGame {
    constructor() {
      this.network = new Network();
      this.audio = new AudioManager();
      this.ui = new UIManager();
      this.dice = new DiceManager();
      this.board = null;
      this.tokens = null;
      
      this.roomId = null;
      this.playerId = null;
      this.myPlayerIndex = -1;
      this.myColorIndex = -1;
      this.gameState = null;
      this.validMoves = [];
      this.isMyTurn = false;
      this.animating = false;
      this.maxPlayers = 4;
      this.players = [];
    }
    
    init() {
      // 1. Init UI & Audio & Dice
      this.ui.init();
      this.dice.init();
      
      // 2. Setup canvas & renderers
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        this.board = new BoardRenderer(canvas);
        this.tokens = new TokenRenderer(this.board);
      }
      
      // 3. Setup network callbacks
      this.setupNetworkHandlers();
      
      // 4. Setup UI event handlers
      this.setupUIHandlers();
      
      // 5. Check URL for room code
      const params = new URLSearchParams(window.location.search);
      const roomCode = params.get('room');
      if (roomCode) {
        const input = document.getElementById('room-code-input');
        if (input) input.value = roomCode;
        this.ui.showToast('Room code detected! Enter your name and click Join.', 'info');
      }
      
      // 6. Handle resize
      window.addEventListener('resize', () => this.onResize());
      
      // 7. Start render loop
      this.renderLoop();
    }
    
    setupNetworkHandlers() {
      const net = this.network;
      
      net.onReady = (roomId) => {
        this.roomId = roomId;
        if (net.isHost) {
          const playerName = this.ui.getPlayerName();
          this.myPlayerIndex = 0;
          this.myColorIndex = 0;
          this.players = [{id: 'host', name: playerName, colorIndex: 0}];
          this.ui.showWaitingRoom(roomId, this.players, true);
        }
      };
      
      net.onMessage = (type, data, fromPeerId) => {
        if (this.network.isHost) {
          this.handleHostMessage(type, data, fromPeerId);
        } else {
          this.handleGuestMessage(type, data);
        }
      };
      
      net.onPlayerDisconnected = (peerId) => {
        const C = window.CONSTANTS;
        const playerIndex = this.getPlayerIndexByPeerId(peerId);
        if (playerIndex !== -1) {
          const player = this.players[playerIndex];
          this.ui.showToast(`${player.name} disconnected`, 'warning');
          this.players.splice(playerIndex, 1);
          
          if (!this.gameState) {
            // Game not started yet: update color indices and sync
            this.players.forEach((p, idx) => p.colorIndex = idx);
            this.ui.updatePlayersList(this.players);
            this.network.broadcast(C.MSG.PLAYER_JOINED, {players: this.players});
            
            if (this.players.length < C.MIN_PLAYERS) {
              const startBtn = document.getElementById('start-game-btn');
              if (startBtn) startBtn.style.display = 'none';
            }
          } else if (this.gameState.currentPlayerIndex === playerIndex) {
            this.advanceTurnOnHost();
          }
        }
      };
      
      net.onError = (msg) => {
        this.ui.showToast(msg, 'error');
        this.audio.playError();
      };
    }
    
    setupUIHandlers() {
      document.getElementById('create-room-btn')?.addEventListener('click', () => this.onCreateRoom());
      document.getElementById('join-room-btn')?.addEventListener('click', () => this.onJoinRoom());
      document.getElementById('start-game-btn')?.addEventListener('click', () => this.onStartGame());
      document.getElementById('roll-dice-btn')?.addEventListener('click', () => this.onRollDice());
      document.getElementById('game-canvas')?.addEventListener('click', (e) => this.onCanvasClick(e));
      document.getElementById('copy-link-btn')?.addEventListener('click', () => this.ui.copyShareLink());
      
      document.getElementById('sound-toggle-btn')?.addEventListener('click', () => {
        const muted = this.audio.toggleMute();
        const btn = document.getElementById('sound-toggle-btn');
        if (btn) btn.textContent = muted ? '🔇' : '🔊';
      });
      
      document.getElementById('back-to-lobby-btn')?.addEventListener('click', () => {
        this.network.disconnect();
        this.ui.showScreen('lobby-screen');
      });
      
      document.getElementById('play-again-btn')?.addEventListener('click', () => {
        this.ui.hideWinnerOverlay();
        this.network.disconnect();
        this.ui.showScreen('lobby-screen');
      });
      
      document.getElementById('player-name')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('create-room-btn')?.click();
      });
      document.getElementById('room-code-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('join-room-btn')?.click();
      });
    }
    
    // ── HOST MESSAGE HANDLING ──
    
    handleHostMessage(type, data, fromPeerId) {
      const C = window.CONSTANTS;
      const MSG = C.MSG;
      
      switch (type) {
        case MSG.JOIN_REQUEST: {
          if (this.gameState) {
            this.network.sendTo(fromPeerId, MSG.JOIN_REJECTED, {reason: 'Game already started'});
            return;
          }
          if (this.players.length >= this.maxPlayers) {
            this.network.sendTo(fromPeerId, MSG.JOIN_REJECTED, {reason: 'Room is full'});
            return;
          }
          
          const colorIndex = this.players.length;
          const playerInfo = {id: fromPeerId, name: data.playerName, colorIndex};
          this.players.push(playerInfo);
          
          // Send acceptance to the joiner
          this.network.sendTo(fromPeerId, MSG.JOIN_ACCEPTED, {
            playerIndex: this.players.length - 1,
            colorIndex,
            players: this.players,
            roomId: this.roomId
          });
          
          // Broadcast updated player list to all connected guests
          this.network.broadcast(MSG.PLAYER_JOINED, {players: this.players});
          
          // Update host UI
          this.ui.updatePlayersList(this.players);
          this.ui.showToast(`${data.playerName} joined!`, 'success');
          this.audio.init();
          this.audio.playYourTurn();
          
          // Enable start game button on host UI if >= MIN_PLAYERS
          if (this.players.length >= C.MIN_PLAYERS) {
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) startBtn.style.display = 'block';
          }
          break;
        }
        
        case MSG.ROLL_DICE: {
          const playerIdx = this.getPlayerIndexByPeerId(fromPeerId);
          if (playerIdx !== this.gameState.currentPlayerIndex) return;
          if (this.gameState.turnPhase !== 'roll') return;
          
          this.handleDiceRoll(playerIdx);
          break;
        }
        
        case MSG.MOVE_TOKEN: {
          const playerIdx2 = this.getPlayerIndexByPeerId(fromPeerId);
          if (playerIdx2 !== this.gameState.currentPlayerIndex) return;
          if (this.gameState.turnPhase !== 'move') return;
          
          this.handleTokenMove(playerIdx2, data.tokenIndex);
          break;
        }
      }
    }
    
    // ── GUEST MESSAGE HANDLING ──
    
    handleGuestMessage(type, data) {
      const C = window.CONSTANTS;
      const MSG = C.MSG;
      
      switch (type) {
        case MSG.JOIN_ACCEPTED:
          this.myPlayerIndex = data.playerIndex;
          this.myColorIndex = data.colorIndex;
          this.players = data.players;
          this.roomId = data.roomId;
          this.ui.showWaitingRoom(this.roomId, this.players, false);
          this.ui.showToast('Joined room successfully!', 'success');
          break;
          
        case MSG.JOIN_REJECTED:
          this.ui.showToast(data.reason || 'Could not join room', 'error');
          this.network.disconnect();
          this.ui.showScreen('lobby-screen');
          break;
          
        case MSG.PLAYER_JOINED:
          this.players = data.players;
          this.ui.updatePlayersList(this.players);
          this.ui.showToast('A player joined!', 'success');
          break;
          
        case MSG.PLAYER_LEFT:
          this.players = data.players;
          this.ui.updatePlayersList(this.players);
          this.ui.showToast(`${data.leftPlayerName || 'A player'} left`, 'warning');
          break;
          
        case MSG.GAME_STARTED:
          this.gameState = data.gameState;
          this.startGameDisplay();
          break;
          
        case MSG.DICE_ROLLED:
          this.onDiceRolledEvent(data);
          break;
          
        case MSG.YOUR_TURN:
          this.onYourTurnEvent(data);
          break;
          
        case MSG.TOKEN_MOVED:
          this.onTokenMovedEvent(data);
          break;
          
        case MSG.TOKEN_CAPTURED:
          this.audio.playCapture();
          this.ui.showToast(`${data.capturerName} captured ${data.capturedName}'s token!`, 'capture');
          this.ui.addLogEntry(`💥 ${data.capturerName} captured ${data.capturedName}'s token!`, 'capture');
          break;
          
        case MSG.TOKEN_FINISHED:
          this.audio.playFinish();
          this.ui.showToast(`${data.playerName} got a token home!`, 'success');
          this.ui.addLogEntry(`🏠 ${data.playerName} finished a token!`, 'finish');
          break;
          
        case MSG.EXTRA_TURN:
          this.ui.showToast(`${data.playerName} gets an extra turn!`, 'info');
          this.ui.addLogEntry(`🔄 ${data.playerName} rolled a 6, extra turn!`, 'info');
          break;
          
        case MSG.TURN_FORFEITED:
          this.ui.showToast(`${data.playerName}'s turn forfeited (3 sixes!)`, 'warning');
          this.ui.addLogEntry(`⚠️ ${data.playerName} rolled 3 sixes, turn forfeited`, 'system');
          break;
          
        case MSG.NO_VALID_MOVES:
          if (data.playerIndex === this.myPlayerIndex) {
            this.ui.showToast('No valid moves!', 'warning');
          }
          this.ui.addLogEntry(`${data.playerName} has no valid moves`, 'system');
          break;
          
        case MSG.PLAYER_WON:
          this.onPlayerWonEvent(data);
          break;
          
        case MSG.GAME_STATE_SYNC:
          this.gameState = data.gameState;
          this.ui.updatePlayerCards(this.gameState);
          break;
      }
    }
    
    // ── GAME ACTIONS (Host) ──
    
    handleDiceRoll(playerIndex) {
      const GL = window.GameLogic;
      const C = window.CONSTANTS;
      const MSG = C.MSG;
      
      const diceValue = GL.rollDice();
      this.gameState.diceValue = diceValue;
      
      if (diceValue === 6) {
        this.gameState.consecutiveSixes++;
        if (this.gameState.consecutiveSixes >= C.MAX_CONSECUTIVE_SIXES) {
          this.gameState.consecutiveSixes = 0;
          const pName = this.gameState.players[playerIndex].name;
          this.network.broadcast(MSG.DICE_ROLLED, {diceValue, playerIndex, playerName: pName});
          this.broadcastToSelf(MSG.DICE_ROLLED, {diceValue, playerIndex, playerName: pName});
          
          setTimeout(() => {
            this.network.broadcast(MSG.TURN_FORFEITED, {playerIndex, playerName: pName});
            this.broadcastToSelf(MSG.TURN_FORFEITED, {playerIndex, playerName: pName});
            this.gameState = GL.advanceTurn(this.gameState);
            this.gameState.consecutiveSixes = 0;
            this.sendTurnNotification();
          }, 1200);
          return;
        }
      } else {
        this.gameState.consecutiveSixes = 0;
      }
      
      const pName = this.gameState.players[playerIndex].name;
      this.network.broadcast(MSG.DICE_ROLLED, {diceValue, playerIndex, playerName: pName});
      this.broadcastToSelf(MSG.DICE_ROLLED, {diceValue, playerIndex, playerName: pName});
      
      const validMoves = GL.getValidMoves(this.gameState, diceValue);
      
      if (validMoves.length === 0) {
        setTimeout(() => {
          this.network.broadcast(MSG.NO_VALID_MOVES, {playerIndex, playerName: pName});
          this.broadcastToSelf(MSG.NO_VALID_MOVES, {playerIndex, playerName: pName});
          this.gameState = GL.advanceTurn(this.gameState);
          setTimeout(() => this.sendTurnNotification(), 800);
        }, 1200);
        return;
      }
      
      this.gameState.turnPhase = 'move';
      
      if (playerIndex === 0) {
        this.broadcastToSelf(MSG.YOUR_TURN, {validMoves, playerIndex});
      } else {
        const peerId = this.players[playerIndex].id;
        this.network.sendTo(peerId, MSG.YOUR_TURN, {validMoves, playerIndex});
      }
    }
    
    handleTokenMove(playerIndex, tokenIndex) {
      const GL = window.GameLogic;
      const C = window.CONSTANTS;
      const MSG = C.MSG;
      
      const validMoves = GL.getValidMoves(this.gameState, this.gameState.diceValue);
      const move = validMoves.find(m => m.tokenIndex === tokenIndex);
      if (!move) return;
      
      const {newState, events} = GL.applyMove(this.gameState, tokenIndex);
      const player = this.gameState.players[playerIndex];
      const pName = player.name;
      
      this.network.broadcast(MSG.TOKEN_MOVED, {
        playerIndex, tokenIndex,
        fromPosition: move.fromPosition,
        toPosition: move.toPosition,
        gameState: newState,
        playerName: pName
      });
      this.broadcastToSelf(MSG.TOKEN_MOVED, {
        playerIndex, tokenIndex,
        fromPosition: move.fromPosition,
        toPosition: move.toPosition,
        gameState: newState,
        playerName: pName
      });
      
      events.forEach(evt => {
        if (evt.type === 'capture') {
          const capturedPlayer = this.gameState.players[evt.capturedPlayerIndex];
          this.network.broadcast(MSG.TOKEN_CAPTURED, {
            capturedPlayerIndex: evt.capturedPlayerIndex,
            capturedTokenIndex: evt.capturedTokenIndex,
            capturerIndex: playerIndex,
            capturerName: pName,
            capturedName: capturedPlayer.name
          });
          this.broadcastToSelf(MSG.TOKEN_CAPTURED, {
            capturedPlayerIndex: evt.capturedPlayerIndex,
            capturedTokenIndex: evt.capturedTokenIndex,
            capturerIndex: playerIndex,
            capturerName: pName,
            capturedName: capturedPlayer.name
          });
        }
        
        if (evt.type === 'finish') {
          this.network.broadcast(MSG.TOKEN_FINISHED, {playerIndex, tokenIndex, playerName: pName});
          this.broadcastToSelf(MSG.TOKEN_FINISHED, {playerIndex, tokenIndex, playerName: pName});
        }
        
        if (evt.type === 'win') {
          this.network.broadcast(MSG.PLAYER_WON, {playerIndex, playerName: pName});
          this.broadcastToSelf(MSG.PLAYER_WON, {playerIndex, playerName: pName});
          this.gameState = newState;
          return;
        }
      });
      
      this.gameState = newState;
      
      if (this.gameState.diceValue === 6 && this.gameState.consecutiveSixes < C.MAX_CONSECUTIVE_SIXES) {
        this.network.broadcast(MSG.EXTRA_TURN, {playerIndex, playerName: pName});
        this.broadcastToSelf(MSG.EXTRA_TURN, {playerIndex, playerName: pName});
        this.gameState.turnPhase = 'roll';
        this.gameState.diceValue = null;
        setTimeout(() => this.sendTurnNotification(), 1500);
      } else {
        this.gameState = GL.advanceTurn(this.gameState);
        setTimeout(() => this.sendTurnNotification(), 1500);
      }
    }
    
    sendTurnNotification() {
      const C = window.CONSTANTS;
      const MSG = C.MSG;
      const currentIdx = this.gameState.currentPlayerIndex;
      
      this.network.broadcast(MSG.GAME_STATE_SYNC, {gameState: this.gameState});
      this.broadcastToSelf(MSG.GAME_STATE_SYNC, {gameState: this.gameState});
      
      if (currentIdx === 0) {
        this.broadcastToSelf(MSG.YOUR_TURN, {playerIndex: currentIdx});
      } else {
        const peerId = this.players[currentIdx]?.id;
        if (peerId) {
          this.network.sendTo(peerId, MSG.YOUR_TURN, {playerIndex: currentIdx});
        }
      }
      
      const pName = this.gameState.players[currentIdx]?.name;
      this.network.broadcast(MSG.GAME_STATE_SYNC, {gameState: this.gameState, currentPlayerName: pName});
      this.broadcastToSelf(MSG.GAME_STATE_SYNC, {gameState: this.gameState, currentPlayerName: pName});
    }
    
    broadcastToSelf(type, data) {
      this.handleGuestMessage(type, data);
    }
    
    // ── UI EVENT HANDLERS ──
    
    onCreateRoom() {
      const name = this.ui.getPlayerName();
      if (!name) { this.ui.showToast('Please enter your name', 'warning'); return; }
      this.maxPlayers = this.ui.getMaxPlayers();
      this.audio.init();
      this.network.createRoom(name, this.maxPlayers);
    }
    
    onJoinRoom() {
      const name = this.ui.getPlayerName();
      const code = this.ui.getRoomCode();
      if (!name) { this.ui.showToast('Please enter your name', 'warning'); return; }
      if (!code) { this.ui.showToast('Please enter a room code', 'warning'); return; }
      this.audio.init();
      this.network.joinRoom(code, name);
    }
    
    onStartGame() {
      if (!this.network.isHost) return;
      const C = window.CONSTANTS;
      if (this.players.length < C.MIN_PLAYERS) {
        this.ui.showToast(`Need at least ${C.MIN_PLAYERS} players`, 'warning');
        return;
      }
      
      const GL = window.GameLogic;
      this.gameState = GL.createInitialGameState(this.players);
      
      this.network.broadcast(C.MSG.GAME_STARTED, {gameState: this.gameState});
      this.broadcastToSelf(C.MSG.GAME_STARTED, {gameState: this.gameState});
      
      setTimeout(() => this.sendTurnNotification(), 500);
    }
    
    onRollDice() {
      if (!this.isMyTurn || this.animating) return;
      this.ui.enableDiceButton(false);
      this.audio.init();
      
      if (this.network.isHost) {
        this.handleDiceRoll(this.myPlayerIndex);
      } else {
        this.network.sendToHost(window.CONSTANTS.MSG.ROLL_DICE, {});
      }
    }
    
    onCanvasClick(event) {
      if (!this.isMyTurn || this.animating) return;
      if (!this.gameState || this.gameState.turnPhase !== 'move') return;
      if (this.validMoves.length === 0) return;
      
      const rect = this.board.canvas.getBoundingClientRect();
      const scaleX = this.board.canvas.width / rect.width;
      const scaleY = this.board.canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      
      const tokenIndex = this.tokens.getTokenAtPixel(x, y, this.gameState, this.myPlayerIndex);
      if (tokenIndex === -1) return;
      
      const move = this.validMoves.find(m => m.tokenIndex === tokenIndex);
      if (!move) return;
      
      this.isMyTurn = false;
      this.tokens.clearSelectableTokens();
      this.ui.enableDiceButton(false);
      
      if (this.network.isHost) {
        this.handleTokenMove(this.myPlayerIndex, tokenIndex);
      } else {
        this.network.sendToHost(window.CONSTANTS.MSG.MOVE_TOKEN, {tokenIndex});
      }
    }
    
    // ── EVENT DISPLAY HANDLERS ──
    
    onDiceRolledEvent(data) {
      const {diceValue, playerIndex, playerName} = data;
      this.audio.playDiceRoll();
      this.dice.roll(diceValue, () => {
        this.ui.addLogEntry(`🎲 ${playerName} rolled ${diceValue}`, 'move');
      });
    }
    
    onYourTurnEvent(data) {
      const {validMoves, playerIndex} = data;
      if (playerIndex !== this.myPlayerIndex) return;
      
      this.isMyTurn = true;
      this.gameState.turnPhase = validMoves ? 'move' : 'roll';
      
      if (validMoves) {
        this.validMoves = validMoves;
        this.tokens.setSelectableTokens(validMoves);
        this.ui.showToast('Click a highlighted token to move', 'info', 2000);
      } else {
        this.validMoves = [];
        this.ui.enableDiceButton(true);
        this.audio.playYourTurn();
      }
      
      const C = window.CONSTANTS;
      const color = C.PLAYER_COLORS[this.myColorIndex];
      this.ui.setTurnIndicator(this.myPlayerIndex, 'You', true, color.primary);
    }
    
    onTokenMovedEvent(data) {
      const {playerIndex, tokenIndex, fromPosition, toPosition, gameState, playerName} = data;
      const colorIndex = this.players[playerIndex]?.colorIndex ?? playerIndex;
      
      this.animating = true;
      this.tokens.clearSelectableTokens();
      
      this.tokens.animateTokenMove(playerIndex, tokenIndex, fromPosition, toPosition, colorIndex, () => {
        this.animating = false;
        this.gameState = gameState;
        this.ui.updatePlayerCards(this.gameState);
        this.audio.playTokenMove();
        this.ui.addLogEntry(`${playerName} moved a token`, 'move');
      });
    }
    
    onPlayerWonEvent(data) {
      const {playerIndex, playerName} = data;
      const C = window.CONSTANTS;
      const colorIndex = this.players[playerIndex]?.colorIndex ?? playerIndex;
      const color = C.PLAYER_COLORS[colorIndex];
      this.audio.playWin();
      this.ui.showWinnerOverlay(playerName, color.primary);
    }
    
    startGameDisplay() {
      this.ui.showScreen('game-screen');
      this.ui.setupPlayerCards(this.gameState.players);
      this.onResize();
    }

    onResize() {
      if (this.board) {
        this.board.resize();
      }
    }
    
    renderLoop() {
      const loop = () => {
        if (this.board && this.gameState) {
          this.board.draw();
          this.tokens.update();
          this.tokens.drawAllTokens(this.gameState);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    findPlayerByPeerId(peerId) {
      return this.players.find(p => p.id === peerId);
    }
    
    getPlayerIndexByPeerId(peerId) {
      return this.players.findIndex(p => p.id === peerId);
    }
    
    advanceTurnOnHost() {
      const GL = window.GameLogic;
      if (this.gameState) {
        this.gameState = GL.advanceTurn(this.gameState);
        this.sendTurnNotification();
      }
    }
  }

  window.LudoGame = LudoGame;

  document.addEventListener('DOMContentLoaded', () => {
    if (window.Network && window.GameLogic) {
      const game = new LudoGame();
      game.init();
      window.gameInstance = game;
    }
  });
})();
