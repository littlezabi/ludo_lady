/**
 * Ludo Lady - UI Manager
 * Handles UI interactions, player cards, logs, toasts, and overlays.
 */

(function() {
  class UIManager {
    constructor() {
      this.elements = {};
    }
    
    init() {
      const ids = [
        'lobby-screen', 'waiting-screen', 'game-screen',
        'player-name', 'player-count-selector', 'create-room-btn', 'join-room-btn',
        'room-code-input', 'room-code-display', 'share-link', 'copy-link-btn',
        'players-list', 'waiting-status', 'start-game-btn', 'back-to-lobby-btn',
        'player-cards', 'game-canvas', 'board-container',
        'dice-container', 'dice-3d', 'roll-dice-btn', 'turn-indicator',
        'game-log', 'sound-toggle-btn',
        'toast-container', 'winner-overlay', 'winner-text', 'winner-subtitle',
        'confetti', 'play-again-btn'
      ];
      ids.forEach(id => {
        this.elements[this.camelCase(id)] = document.getElementById(id);
      });
      
      this.setupPlayerCountSelector();
    }
    
    camelCase(str) {
      return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }
    
    // Screen Management
    showScreen(screenId) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const target = document.getElementById(screenId);
      if (target) target.classList.add('active');
    }
    
    // Lobby
    getPlayerName() { return this.elements.playerName?.value.trim() || ''; }
    getMaxPlayers() {
      const active = document.querySelector('.count-btn.active');
      return active ? parseInt(active.dataset.count) : 4;
    }
    getRoomCode() { return this.elements.roomCodeInput?.value.trim().toUpperCase() || ''; }
    
    setupPlayerCountSelector() {
      const buttons = document.querySelectorAll('.count-btn');
      buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }
    
    // Waiting Room
    showWaitingRoom(roomId, players, isHost) {
      this.showScreen('waiting-screen');
      if (this.elements.roomCodeDisplay) this.elements.roomCodeDisplay.textContent = roomId;
      if (this.elements.shareLink) {
        this.elements.shareLink.value = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
      }
      this.updatePlayersList(players);
      if (this.elements.startGameBtn) {
        this.elements.startGameBtn.style.display = isHost ? 'block' : 'none';
      }
      if (this.elements.waitingStatus) {
        this.elements.waitingStatus.textContent = isHost ? 
          'Share the link and wait for players...' : 'Waiting for host to start...';
      }
    }
    
    updatePlayersList(players) {
      const C = window.CONSTANTS;
      if (!this.elements.playersList) return;
      this.elements.playersList.innerHTML = players.map((p, i) => {
        const color = C.PLAYER_COLORS[p.colorIndex] || C.PLAYER_COLORS[i];
        return `<div class="player-item">
          <span class="player-color-dot" style="background:${color.primary}"></span>
          <span class="player-name">${p.name}</span>
          ${i === 0 ? '<span class="host-badge" style="margin-left:auto;font-size:0.75rem;opacity:0.8;">(HOST)</span>' : ''}
        </div>`;
      }).join('');
    }
    
    copyShareLink() {
      const link = this.elements.shareLink?.value || '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
          this.showToast('Link copied to clipboard!', 'success');
        }).catch(() => {
          this.fallbackCopyLink();
        });
      } else {
        this.fallbackCopyLink();
      }
    }

    fallbackCopyLink() {
      if (this.elements.shareLink) {
        this.elements.shareLink.select();
        document.execCommand('copy');
        this.showToast('Link copied!', 'success');
      }
    }
    
    // Game Screen
    setupPlayerCards(players) {
      const C = window.CONSTANTS;
      if (!this.elements.playerCards) return;
      this.elements.playerCards.innerHTML = players.map((p, i) => {
        const color = C.PLAYER_COLORS[p.colorIndex] || C.PLAYER_COLORS[i];
        return `<div class="player-card" id="player-card-${i}" style="--card-color:${color.primary};--glow-color:${color.glow}">
          <div class="player-name-disp">${p.name}</div>
          <div class="token-status" id="player-tokens-${i}">
            ${[0,1,2,3].map(t => `<span class="token-dot" style="background:${color.primary}" data-state="home"></span>`).join('')}
          </div>
        </div>`;
      }).join('');
    }
    
    updatePlayerCards(gameState) {
      if (!gameState) return;
      gameState.players.forEach((player, i) => {
        const card = document.getElementById(`player-card-${i}`);
        if (!card) return;
        
        card.classList.toggle('active', i === gameState.currentPlayerIndex);
        
        player.tokens.forEach((token, ti) => {
          const dot = card.querySelectorAll('.token-dot')[ti];
          if (dot) {
            dot.setAttribute('data-state', token.state);
            if (token.state === 'finished') {
              dot.style.opacity = '1.0';
              dot.style.boxShadow = '0 0 8px #fff';
            } else if (token.state === 'active') {
              dot.style.opacity = '0.8';
            } else {
              dot.style.opacity = '0.3';
            }
          }
        });
      });
    }
    
    setTurnIndicator(playerIndex, playerName, isYourTurn, playerColor) {
      const indicator = this.elements.turnIndicator;
      if (!indicator) return;
      if (isYourTurn) {
        indicator.innerHTML = `<strong style="color:${playerColor}">🎯 Your Turn!</strong>`;
        indicator.classList.add('your-turn');
      } else {
        indicator.innerHTML = `<span style="color:${playerColor}">${playerName}'s turn</span>`;
        indicator.classList.remove('your-turn');
      }
    }
    
    enableDiceButton(enable) {
      const btn = this.elements.rollDiceBtn;
      if (btn) btn.disabled = !enable;
    }
    
    // Game Log
    addLogEntry(message, type = 'info') {
      const log = this.elements.gameLog;
      if (!log) return;
      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = message;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
      while (log.children.length > 50) log.removeChild(log.firstChild);
    }
    
    // Toast Notifications
    showToast(message, type = 'info', duration = 3000) {
      const container = this.elements.toastContainer;
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    
    // Winner Overlay
    showWinnerOverlay(playerName, playerColor) {
      if (this.elements.winnerText) {
        this.elements.winnerText.innerHTML = `🏆 ${playerName}`;
        this.elements.winnerText.style.color = playerColor;
      }
      if (this.elements.winnerSubtitle) {
        this.elements.winnerSubtitle.textContent = 'has won the game!';
      }
      if (this.elements.winnerOverlay) {
        this.elements.winnerOverlay.classList.remove('hidden');
      }
      this.createConfetti();
    }
    
    hideWinnerOverlay() {
      if (this.elements.winnerOverlay) {
        this.elements.winnerOverlay.classList.add('hidden');
      }
      if (this.elements.confetti) {
        this.elements.confetti.innerHTML = '';
      }
    }
    
    createConfetti() {
      const container = this.elements.confetti;
      if (!container) return;
      container.innerHTML = '';
      const colors = ['#E74C3C', '#27AE60', '#F1C40F', '#2980B9', '#9B59B6', '#E67E22', '#1ABC9C'];
      for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.setProperty('--fall-duration', (2 + Math.random() * 3) + 's');
        piece.style.setProperty('--fall-delay', (Math.random() * 2) + 's');
        piece.style.width = (6 + Math.random() * 8) + 'px';
        piece.style.height = (6 + Math.random() * 8) + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        container.appendChild(piece);
      }
    }
  }

  window.UIManager = UIManager;
})();
