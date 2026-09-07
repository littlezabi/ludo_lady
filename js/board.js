/**
 * Ludo Lady - Board Renderer
 * Canvas 3D Board Renderer.
 */

(function() {
  class BoardRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cellSize = 0;
      this.boardSize = 0;
    }
    
    /** Resize canvas to fit container, maintaining 1:1 aspect ratio */
    resize() {
      const container = this.canvas.parentElement;
      if (!container) return;
      const size = Math.min(container.clientWidth || 600, container.clientHeight || 600, 700);
      this.canvas.width = size;
      this.canvas.height = size;
      this.cellSize = size / (window.CONSTANTS.GRID_SIZE || 15);
      this.boardSize = size;
    }
    
    /** Main draw method - draws entire board */
    draw() {
      if (!this.boardSize) this.resize();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.boardSize, this.boardSize);
      this.drawBackground();
      this.drawHomeBases();
      this.drawTrackCells();
      this.drawHomeColumns();
      this.drawCenterHome();
      this.drawSafeZoneStars();
      this.drawStartArrows();
      this.drawGridLines();
    }
    
    drawBackground() {
      const grad = this.ctx.createRadialGradient(
        this.boardSize / 2, this.boardSize / 2, 0,
        this.boardSize / 2, this.boardSize / 2, this.boardSize
      );
      grad.addColorStop(0, '#2a1f1a');
      grad.addColorStop(1, '#1a1210');
      
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, this.boardSize, this.boardSize);
    }
    
    drawHomeBases() {
      const C = window.CONSTANTS;
      const ctx = this.ctx;
      const cs = this.cellSize;
      
      C.HOME_BASE_BOUNDS.forEach((bounds, playerIdx) => {
        const colors = C.PLAYER_COLORS[playerIdx];
        
        const x = bounds.col * cs;
        const y = bounds.row * cs;
        const w = bounds.width * cs;
        const h = bounds.height * cs;
        
        // Outer colored rect
        ctx.fillStyle = colors.primary;
        ctx.globalAlpha = 0.85;
        this.drawRoundedRect(x, y, w, h, cs * 0.5);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        
        // Inner white/light parking card
        ctx.fillStyle = '#ffffff';
        const inset = cs;
        this.drawRoundedRect(x + inset, y + inset, w - inset * 2, h - inset * 2, cs * 0.3);
        ctx.fill();
        
        // Token spots
        C.HOME_BASE_TOKEN_POSITIONS[playerIdx].forEach(pos => {
          const cx = pos[1] * cs + cs / 2;
          const cy = pos[0] * cs + cs / 2;
          ctx.strokeStyle = colors.primary;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, cs * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        });
      });
    }
    
    drawRoundedRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    
    drawTrackCells() {
      const C = window.CONSTANTS;
      C.MAIN_PATH.forEach(pos => {
        this.drawCell(pos[0], pos[1], '#f5f0e8');
      });
    }
    
    drawHomeColumns() {
      const C = window.CONSTANTS;
      C.HOME_COLUMNS.forEach((colCells, playerIdx) => {
        const colors = C.PLAYER_COLORS[playerIdx];
        colCells.forEach(pos => {
          this.drawCell(pos[0], pos[1], colors.light);
        });
      });
    }
    
    drawCenterHome() {
      const ctx = this.ctx;
      const cs = this.cellSize;
      const C = window.CONSTANTS;
      const center = 7.5 * cs;
      
      const triangles = [
        { // Red (top-left)
          p1: {x: 6*cs, y: 6*cs}, p2: {x: 9*cs, y: 6*cs},
          color: C.PLAYER_COLORS[0].primary
        },
        { // Green (top-right)
          p1: {x: 9*cs, y: 6*cs}, p2: {x: 9*cs, y: 9*cs},
          color: C.PLAYER_COLORS[1].primary
        },
        { // Yellow (bottom-right)
          p1: {x: 9*cs, y: 9*cs}, p2: {x: 6*cs, y: 9*cs},
          color: C.PLAYER_COLORS[2].primary
        },
        { // Blue (bottom-left)
          p1: {x: 6*cs, y: 9*cs}, p2: {x: 6*cs, y: 6*cs},
          color: C.PLAYER_COLORS[3].primary
        }
      ];
      
      triangles.forEach(tri => {
        ctx.fillStyle = tri.color;
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(tri.p1.x, tri.p1.y);
        ctx.lineTo(tri.p2.x, tri.p2.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
      
      // Center circle
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(center, center, cs * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    
    drawSafeZoneStars() {
      const C = window.CONSTANTS;
      const cs = this.cellSize;
      
      C.STAR_CELL_INDICES.forEach(idx => {
        const pos = C.MAIN_PATH[idx];
        const px = this.gridToPixel(pos[0], pos[1]);
        this.drawStar(px.x, px.y, cs * 0.35, cs * 0.15, 5, '#cccccc');
      });
      
      C.PLAYER_START_INDICES.forEach((idx, playerIdx) => {
        const pos = C.MAIN_PATH[idx];
        const px = this.gridToPixel(pos[0], pos[1]);
        const color = C.PLAYER_COLORS[playerIdx].primary;
        this.drawStar(px.x, px.y, cs * 0.35, cs * 0.15, 5, color);
      });
    }
    
    drawStartArrows() {
      const C = window.CONSTANTS;
      const cs = this.cellSize;
      const ctx = this.ctx;
      
      C.PLAYER_START_INDICES.forEach((idx, playerIdx) => {
        const pos = C.MAIN_PATH[idx];
        const px = this.gridToPixel(pos[0], pos[1]);
        const color = C.PLAYER_COLORS[playerIdx].primary;
        
        ctx.fillStyle = color;
        
        let ang = 0;
        if (playerIdx === 0) ang = 0;
        else if (playerIdx === 1) ang = Math.PI/2;
        else if (playerIdx === 2) ang = Math.PI;
        else if (playerIdx === 3) ang = -Math.PI/2;

        ctx.save();
        ctx.translate(px.x, px.y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(-cs*0.2, -cs*0.2);
        ctx.lineTo(cs*0.2, 0);
        ctx.lineTo(-cs*0.2, cs*0.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }
    
    drawStar(cx, cy, outerRadius, innerRadius, points, color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    drawGridLines() {
      const C = window.CONSTANTS;
      const ctx = this.ctx;
      const cs = this.cellSize;
      
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      
      const allCells = [...C.MAIN_PATH];
      C.HOME_COLUMNS.forEach(col => allCells.push(...col));
      
      allCells.forEach(pos => {
        const x = pos[1] * cs;
        const y = pos[0] * cs;
        ctx.strokeRect(x, y, cs, cs);
      });
    }
    
    drawCell(row, col, fillColor) {
      const ctx = this.ctx;
      const cs = this.cellSize;
      const x = col * cs;
      const y = row * cs;
      
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, cs, cs);
      
      // 3D bevel
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(x, y + cs);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cs, y);
      ctx.lineTo(x + cs - 2, y + 2);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + 2, y + cs - 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.moveTo(x, y + cs);
      ctx.lineTo(x + cs, y + cs);
      ctx.lineTo(x + cs, y);
      ctx.lineTo(x + cs - 2, y + 2);
      ctx.lineTo(x + cs - 2, y + cs - 2);
      ctx.lineTo(x + 2, y + cs - 2);
      ctx.fill();
    }
    
    /** Convert grid [row,col] to canvas pixel coords (center of cell) */
    gridToPixel(row, col) {
      return {
        x: col * this.cellSize + this.cellSize / 2,
        y: row * this.cellSize + this.cellSize / 2
      };
    }
    
    /** Convert canvas pixel coords to grid [row,col] */
    pixelToGrid(px, py) {
      return {
        row: Math.floor(py / this.cellSize),
        col: Math.floor(px / this.cellSize)
      };
    }
  }

  window.BoardRenderer = BoardRenderer;
})();
