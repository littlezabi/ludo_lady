import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { GameState } from './wasmLoader';

// Optional Supabase credentials from environment or fallback
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseClient = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

let currentChannel: RealtimeChannel | null = null;

export interface RoomEvent {
  type: 'STATE_UPDATE' | 'DICE_ROLL' | 'TOKEN_MOVE';
  state: GameState;
  senderId: string;
}

export function isMultiplayerAvailable(): boolean {
  return supabaseClient !== null;
}

export function generateRoomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


export function joinRoom(
  roomCode: string, 
  onStateReceived: (state: GameState) => void
): void {
  if (!supabaseClient) {
    console.warn("Supabase not configured. Operating in local mode.");
    return;
  }

  if (currentChannel) {
    supabaseClient.removeChannel(currentChannel);
  }

  currentChannel = supabaseClient.channel(`ludo_room_${roomCode}`);

  currentChannel
    .on('broadcast', { event: 'GAME_ACTION' }, (payload) => {
      const event: RoomEvent = payload.payload;
      if (event && event.state) {
        onStateReceived(event.state);
      }
    })
    .subscribe((status) => {
      console.log(`Subscribed to room ${roomCode} with status: ${status}`);
    });
}

export function broadcastGameState(state: GameState, senderId: string = 'host'): void {
  if (!currentChannel) return;

  const event: RoomEvent = {
    type: 'STATE_UPDATE',
    state,
    senderId
  };

  currentChannel.send({
    type: 'broadcast',
    event: 'GAME_ACTION',
    payload: event
  });
}
