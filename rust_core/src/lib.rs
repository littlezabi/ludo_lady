mod board;
mod rules;

use rules::GameState;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_game(num_players: u8) -> String {
    create_game_mode(num_players, false)
}

#[wasm_bindgen]
pub fn create_game_mode(num_players: u8, is_team_mode: bool) -> String {
    let mut state = GameState::new(num_players);
    state.is_team_mode = is_team_mode;
    serde_json::to_string(&state).unwrap_or_default()
}

#[wasm_bindgen]
pub fn create_game_vs_computer(num_players: u8, is_team_mode: bool, computer_count: u8) -> String {
    let mut state = GameState::new(num_players);
    state.is_team_mode = is_team_mode;
    state.player_types = vec![0; num_players as usize];

    // Assign Computer AI players (type 1)
    let count = computer_count.clamp(1, num_players - 1);
    for i in 1..=count {
        let p_idx = (num_players - i) as usize;
        if p_idx < state.player_types.len() {
            state.player_types[p_idx] = 1;
        }
    }

    serde_json::to_string(&state).unwrap_or_default()
}

#[wasm_bindgen]
pub fn roll_dice(state_json: &str) -> String {
    let mut state: GameState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(_) => return state_json.to_string(),
    };

    state.roll_dice();
    serde_json::to_string(&state).unwrap_or_default()
}

#[wasm_bindgen]
pub fn get_valid_tokens(state_json: &str) -> String {
    let state: GameState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(_) => return "[]".to_string(),
    };

    let valid = state.get_valid_tokens();
    serde_json::to_string(&valid).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn get_best_ai_move(state_json: &str) -> i16 {
    let state: GameState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(_) => return -1,
    };

    match state.select_best_ai_move() {
        Some(id) => id as i16,
        None => -1,
    }
}

#[wasm_bindgen]
pub fn move_token(state_json: &str, token_id: u8) -> String {
    let mut state: GameState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(_) => return state_json.to_string(),
    };

    state.move_token(token_id);
    serde_json::to_string(&state).unwrap_or_default()
}
