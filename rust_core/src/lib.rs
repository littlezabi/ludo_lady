mod board;
mod rules;

use rules::GameState;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_game(num_players: u8) -> String {
    let state = GameState::new(num_players);
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
pub fn move_token(state_json: &str, token_id: u8) -> String {
    let mut state: GameState = match serde_json::from_str(state_json) {
        Ok(s) => s,
        Err(_) => return state_json.to_string(),
    };

    state.move_token(token_id);
    serde_json::to_string(&state).unwrap_or_default()
}
