/**
 * Ludo Lady - Dice Manager
 * 3D CSS Cube Dice Controller.
 */

(function() {
  class DiceManager {
    constructor() {
      this.diceElement = null;
      this.currentValue = 1;
      this.isRolling = false;
    }
    
    init() {
      this.diceElement = document.getElementById('dice-3d');
      if (this.diceElement) {
        this.setupPips();
      }
    }
    
    /** Create pip dots inside each dice face */
    setupPips() {
      if (!this.diceElement) return;
      const faces = this.diceElement.querySelectorAll('.dice-face');
      const pipCounts = [1, 6, 3, 4, 5, 2]; // front, back, right, left, top, bottom
      
      faces.forEach((face, i) => {
        face.innerHTML = '';
        const count = pipCounts[i];
        face.setAttribute('data-value', count.toString());
        
        for (let p = 0; p < count; p++) {
          const pip = document.createElement('div');
          pip.className = 'pip';
          face.appendChild(pip);
        }
        
        face.classList.add(`pips-${count}`);
      });
    }
    
    /** Roll dice with animation, showing target value */
    roll(targetValue, callback) {
      if (this.isRolling || !this.diceElement) return;
      this.isRolling = true;
      this.currentValue = targetValue;
      
      this.diceElement.classList.add('rolling');
      
      setTimeout(() => {
        if (!this.diceElement) return;
        this.diceElement.classList.remove('rolling');
        
        const transforms = {
          1: 'rotateX(0deg) rotateY(0deg)',          // front
          2: 'rotateX(0deg) rotateY(180deg)',         // back
          3: 'rotateX(0deg) rotateY(-90deg)',         // right
          4: 'rotateX(0deg) rotateY(90deg)',          // left
          5: 'rotateX(-90deg) rotateY(0deg)',         // top
          6: 'rotateX(90deg) rotateY(0deg)'           // bottom
        };
        
        this.diceElement.style.transform = transforms[targetValue] || transforms[1];
        
        setTimeout(() => {
          this.isRolling = false;
          if (callback) callback(targetValue);
        }, 400);
      }, 800);
    }
    
    reset() {
      if (this.diceElement) {
        this.diceElement.style.transform = 'rotateX(0deg) rotateY(0deg)';
      }
      this.currentValue = 1;
    }
  }

  window.DiceManager = DiceManager;
})();
