/**
 * Ludo Lady - Network
 * PeerJS-based P2P networking layer for Host and Guest.
 */

(function() {
  class Network {
    constructor() {
      this.peer = null;
      this.connections = new Map(); // peerId -> {conn}
      this.hostConn = null; // guest's connection to host
      this.isHost = false;
      this.roomId = null;
      this.onMessage = null; // callback(type, data, fromPeerId)
      this.onPlayerConnected = null; // callback(peerId, playerName)
      this.onPlayerDisconnected = null; // callback(peerId)
      this.onError = null; // callback(errorMsg)
      this.onReady = null; // callback(roomId)
    }

    /**
     * Generates a 6-character room ID.
     * @returns {string} The room ID.
     */
    generateRoomId() {
      return 'LUDO-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    /**
     * Creates a room as a host.
     * @param {string} playerName - The name of the host.
     * @param {number} maxPlayers - Max number of players.
     */
    createRoom(playerName, maxPlayers = 4) {
      this.isHost = true;
      this.roomId = this.generateRoomId();
      
      // @ts-ignore
      this.peer = new Peer(this.roomId);

      this.peer.on('open', (id) => {
        console.log('Room created with ID:', id);
        if (this.onReady) this.onReady(this.roomId);
      });

      this.peer.on('connection', (conn) => {
        this.connections.set(conn.peer, { conn });

        conn.on('data', (data) => {
          if (this.onMessage && data && data.type) {
            this.onMessage(data.type, data.data, conn.peer);
          }
        });

        conn.on('close', () => {
          this.connections.delete(conn.peer);
          if (this.onPlayerDisconnected) this.onPlayerDisconnected(conn.peer);
        });
        
        conn.on('error', (err) => {
          console.error('Connection error:', err);
        });
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (this.onError) this.onError(err.message || 'P2P Connection Error');
      });
    }

    /**
     * Joins a room as a guest.
     * @param {string} roomId - The room ID to join.
     * @param {string} playerName - The guest's name.
     */
    joinRoom(roomId, playerName) {
      const MSG = window.CONSTANTS.MSG;
      this.isHost = false;
      this.roomId = roomId;

      // @ts-ignore
      this.peer = new Peer();

      this.peer.on('open', (id) => {
        this.hostConn = this.peer.connect(roomId, { reliable: true });

        this.hostConn.on('open', () => {
          this.hostConn.send({ type: MSG.JOIN_REQUEST, data: { playerName } });
          if (this.onReady) this.onReady(roomId);
        });

        this.hostConn.on('data', (data) => {
          if (this.onMessage && data && data.type) {
            this.onMessage(data.type, data.data, this.hostConn.peer);
          }
        });

        this.hostConn.on('close', () => {
          if (this.onPlayerDisconnected) this.onPlayerDisconnected(this.hostConn.peer);
        });
        
        this.hostConn.on('error', (err) => {
          console.error('Host connection error:', err);
          if (this.onError) this.onError('Could not connect to host. Check Room Code.');
        });
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (this.onError) this.onError('P2P Error: Room ID not found or connection failed.');
      });
    }

    /**
     * Host: Sends a message to all connected guests.
     * @param {string} type - Message type.
     * @param {any} data - Message data.
     */
    broadcast(type, data) {
      const msg = { type, data };
      this.connections.forEach(({ conn }) => {
        if (conn && conn.open) conn.send(msg);
      });
    }

    /**
     * Host: Sends a message to a specific guest.
     * @param {string} peerId - The guest's peer ID.
     * @param {string} type - Message type.
     * @param {any} data - Message data.
     */
    sendTo(peerId, type, data) {
      const connection = this.connections.get(peerId);
      if (connection && connection.conn && connection.conn.open) {
        connection.conn.send({ type, data });
      }
    }

    /**
     * Guest: Sends a message to the host.
     * @param {string} type - Message type.
     * @param {any} data - Message data.
     */
    sendToHost(type, data) {
      if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ type, data });
      }
    }

    /**
     * Disconnects the peer.
     */
    disconnect() {
      if (this.peer) {
        this.peer.destroy();
        this.peer = null;
      }
      this.connections.clear();
      this.hostConn = null;
    }
  }

  window.Network = Network;
})();
