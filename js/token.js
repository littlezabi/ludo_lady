/**
 * Ludo Lady - Token Renderer
 * Canvas Token Renderer.
 */

(function() {
  class TokenRenderer {
    constructor(boardRenderer) {
      this.board = boardRenderer;
      this.animations = []; // [{playerIndex, tokenIndex, path, currentStep, startTime, duration, callback}]
      this.selectableTokens = []; // [{tokenIndex, ...moveData}]
      this.glowPhase = 0;
    }
    
    /** Draw all tokens for all players */
    drawAllTokens(gameState) {
      if (!gameState) return;
      const C = window.CONSTANTS;
      
      // For each player:
      for (let pi = 0; pi < gameState.players.length; pi++) {
        const player = gameState.players[pi];
        const colors = C.PLAYER_COLORS[player.colorIndex] || C.PLAYER_COLORS[pi];
        
        // Group tokens by position to handle stacking
        const positionGroups = {};
        
        player.tokens.forEach((token, ti) => {
          // Skip tokens being animated
          if (this.isTokenAnimating(pi, ti)) return;
          
          let pos = null;
          if (token.state === C.TOKEN_STATES.HOME) {
            // Home base position
            const basePos = C.HOME_BASE_TOKEN_POSITIONS[player.colorIndex][ti];
            pos = this.board.gridToPixel(basePos[0], basePos[1]);
          } else if (token.state === C.TOKEN_STATES.ACTIVE) {
            // Board position
            const gridPos = C.PLAYER_PATHS[player.colorIndex][token.position];
            if (gridPos) {
              pos = this.board.gridToPixel(gridPos[0], gridPos[1]);
            }
          } else if (token.state === C.TOKEN_STATES.FINISHED) {
            // Center area position offset for multiple finished tokens
            const offsets = [[7,7],[7.2,7],[7,7.2],[7.2,7.2]];
            const offset = offsets[ti] || [7,7];
            pos = this.board.gridToPixel(offset[0], offset[1]);
          }
          
          if (!pos) return;
          
          const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
          if (!positionGroups[key]) positionGroups[key] = [];
          positionGroups[key].push({pi, ti, pos, colors});
        });
        
        // Draw tokens with stacking offset
        Object.values(positionGroups).forEach(group => {
          group.forEach((item, idx) => {
            const offset = this.getStackOffset(idx, group.length);
            const isSelectable = this.isTokenSelectable(item.pi, item.ti);
            this.drawToken(
              item.pos.x + offset.x,
              item.pos.y + offset.y,
              item.colors,
              isSelectable,
              item.pi === gameState.currentPlayerIndex ? 1.0 : 0.9
            );
          });
        });
      }
      
      // Draw animating tokens on top
      this.drawAnimatingTokens();
    }
    
    /** Draw a single 3D token (sphere with shadow) */
    drawToken(x, y, colors, isSelected, scale = 1.0) {
      const ctx = this.board.ctx;
      const radius = this.board.cellSize * 0.32 * scale;
      
      // 1. Shadow (dark ellipse below)
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x, y + radius * 0.3, radius * 0.8, radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // 2. Main body - radial gradient (light center to dark edge)
      const grad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.3, radius * 0.1, x, y, radius);
      grad.addColorStop(0, colors.light);
      grad.addColorStop(0.7, colors.primary);
      grad.addColorStop(1, colors.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // 3. Border
      ctx.strokeStyle = colors.dark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // 4. Highlight spot (top-left)
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
      
      // 5. Selection glow
      if (isSelected) {
        ctx.strokeStyle = colors.glow;
        ctx.lineWidth = 3;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 10 + Math.sin(this.glowPhase) * 5;
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      
      ctx.restore();
    }
    
    getStackOffset(index, total) {
      if (total <= 1) return {x: 0, y: 0};
      const offsets = [
        {x: -4, y: -4}, {x: 4, y: -4},
        {x: -4, y: 4}, {x: 4, y: 4}
      ];
      return offsets[index] || {x: 0, y: 0};
    }
    
    setSelectableTokens(validMoves) {
      this.selectableTokens = validMoves || [];
    }
    
    clearSelectableTokens() {
      this.selectableTokens = [];
    }
    
    isTokenSelectable(playerIndex, tokenIndex) {
      return this.selectableTokens.some(m => m.tokenIndex === tokenIndex);
    }
    
    isTokenAnimating(playerIndex, tokenIndex) {
      return this.animations.some(a => a.playerIndex === playerIndex && a.tokenIndex === tokenIndex);
    }
    
    /** Get the token at pixel position (for click detection) */
    getTokenAtPixel(x, y, gameState, playerIndex) {
      const C = window.CONSTANTS;
      const player = gameState.players.find(p => p.colorIndex === playerIndex) || gameState.players[playerIndex];
      if (!player) return -1;
      
      const hitRadius = this.board.cellSize * 0.35;
      
      for (let ti = 0; ti < player.tokens.length; ti++) {
        const token = player.tokens[ti];
        let pos = null;
        
        if (token.state === C.TOKEN_STATES.HOME) {
          const basePos = C.HOME_BASE_TOKEN_POSITIONS[player.colorIndex][ti];
          pos = this.board.gridToPixel(basePos[0], basePos[1]);
        } else if (token.state === C.TOKEN_STATES.ACTIVE) {
          const gridPos = C.PLAYER_PATHS[player.colorIndex][token.position];
          if (gridPos) {
            pos = this.board.gridToPixel(gridPos[0], gridPos[1]);
          }
        }
        
        if (pos) {
          const dx = x - pos.x;
          const dy = y - pos.y;
          if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
            if (this.isTokenSelectable(playerIndex, ti)) {
              return ti;
            }
          }
        }
      }
      return -1;
    }
    
    /** Animate token moving along path cells */
    animateTokenMove(playerIndex, tokenIndex, fromPos, toPos, playerColorIndex, callback) {
      const C = window.CONSTANTS;
      const path = [];
      
      const start = Math.max(fromPos, 0);
      const end = Math.min(toPos, C.FULL_PATH_LENGTH - 1);
      
      for (let p = start; p <= end; p++) {
        if (p < C.PLAYER_PATHS[playerColorIndex].length) {
          const gridPos = C.PLAYER_PATHS[playerColorIndex][p];
          path.push(this.board.gridToPixel(gridPos[0], gridPos[1]));
        }
      }
      
      if (path.length < 2) {
        if (callback) callback();
        return;
      }
      
      this.animations.push({
        playerIndex,
        tokenIndex,
        playerColorIndex,
        path,
        currentStep: 0,
        stepProgress: 0,
        stepDuration: 120, // ms per cell
        lastTime: performance.now(),
        callback
      });
    }
    
    /** Draw tokens that are currently animating */
    drawAnimatingTokens() {
      const C = window.CONSTANTS;
      
      this.animations.forEach(anim => {
        const colors = C.PLAYER_COLORS[anim.playerColorIndex];
        
        const from = anim.path[anim.currentStep];
        const to = anim.path[Math.min(anim.currentStep + 1, anim.path.length - 1)];
        const t = anim.stepProgress;
        
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        
        this.drawToken(x, y, colors, false, 1.1);
      });
    }
    
    /** Update animation state. Returns true if animations are active */
    update() {
      const now = performance.now();
      this.glowPhase += 0.05;
      
      this.animations = this.animations.filter(anim => {
        const dt = now - anim.lastTime;
        anim.lastTime = now;
        anim.stepProgress += dt / anim.stepDuration;
        
        if (anim.stepProgress >= 1) {
          anim.stepProgress = 0;
          anim.currentStep++;
          
          if (anim.currentStep >= anim.path.length - 1) {
            if (anim.callback) anim.callback();
            return false;
          }
        }
        return true;
      });
      
      return this.animations.length > 0;
    }
  }

  window.TokenRenderer = TokenRenderer;
})();
