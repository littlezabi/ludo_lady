# 🎲 Ludo Lady — Serverless P2P Browser Game

**Ludo Lady** is a modern, lightweight, serverless Peer-to-Peer (P2P) Ludo browser game built for 2, 3, or 4 players on a single board. It requires no backend server or user signups — just open the link, share the room code with family or friends, and start playing!

---

## ✨ Features

- **100% Client-Side & Serverless**: Direct WebRTC browser-to-browser P2P networking via PeerJS.
- **3D Canvas Board & Spherical Tokens**: Custom HTML5 Canvas rendering 3D-styled wooden board, beveled track cells, safe-zone stars, and 3D sphere tokens with radial lighting and step animations.
- **Interactive 3D CSS Dice**: Physics-animated 3D cube dice with real face rotations.
- **Glassmorphism UI**: Sleek dark-mode aesthetic, active turn glow cards, side game log, toast notifications, and celebration confetti.
- **Procedural Synthesized Audio**: Built-in sound effects generated on-the-fly via Web Audio API without external media files.

---

## 🎮 How to Play

1. **Serve Files**:
   Host the static files using any local web server (e.g. Python):
   ```bash
   python3 -m http.server 8080
   ```

2. **Host a Game**:
   - Open `http://localhost:8080` in your browser.
   - Enter your name, select **2, 3, or 4 players**, and click **🏠 Create Room**.
   - Copy the generated Room Code or Room Link and share it with your friends.

3. **Join & Start**:
   - Friends enter their name, paste the Room Code, and click **🚪 Join Room**.
   - Once all players join, the host clicks **🎮 Start Game**!

---

## 📄 License

MIT License. Free for personal & family fun!
