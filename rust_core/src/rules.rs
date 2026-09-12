use crate::board::{is_safe_zone, PlayerColor, Token};
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    pub num_players: u8,
    pub current_turn: u8, // 0..num_players-1
    pub dice_roll: u8,    // 0 if waiting for roll, 1..6 if rolled
    pub consecutive_sixes: u8,
    pub winner: Option<u8>,
    pub tokens: Vec<Token>,
    pub last_action: String,
    #[serde(default)]
    pub is_team_mode: bool, // 2v2 Partnership Mode (Red+Yellow vs Green+Blue)
    #[serde(default)]
    pub winners_rank: Vec<u8>, // Ranking order of players as they finish (0: Red, 1: Green, 2: Yellow, 3: Blue)
    #[serde(default)]
    pub player_types: Vec<u8>, // 0: Human, 1: Computer AI
}

impl GameState {
    pub fn new(num_players: u8) -> Self {
        let num_players = num_players.clamp(2, 4);
        let mut tokens = Vec::new();

        for p_idx in 0..num_players {
            let color = PlayerColor::from_idx(p_idx);
            for t_id in 0..4 {
                tokens.push(Token::new(p_idx * 4 + t_id, color));
            }
        }

        Self {
            num_players,
            current_turn: 0,
            dice_roll: 0,
            consecutive_sixes: 0,
            winner: None,
            tokens,
            last_action: "Game initialized".to_string(),
            is_team_mode: false,
            winners_rank: Vec::new(),
            is_game_over: false,
            player_types: vec![0; num_players as usize],
        }
    }

    pub fn roll_dice(&mut self) -> u8 {
        if self.is_game_over {
            return self.dice_roll;
        }

        // Strict Turn Lock: If dice was already rolled and player has valid moves, DO NOT re-roll! Force player to move first!
        if self.dice_roll > 0 && !self.get_valid_tokens().is_empty() {
            return self.dice_roll;
        }

        // If previous turn had no valid moves (and was not a 6), advance turn now before rolling
        if self.dice_roll > 0 && self.get_valid_tokens().is_empty() {
            self.next_turn();
        }

        let mut rng = rand::thread_rng();
        let roll: u8 = rng.gen_range(1..=6);
        self.dice_roll = roll;

        if roll == 6 {
            self.consecutive_sixes += 1;
        } else {
            self.consecutive_sixes = 0;
        }

        // If 3 consecutive sixes, forfeit turn
        if self.consecutive_sixes == 3 {
            self.last_action = format!("Player {} rolled 6 three times! Turn forfeited.", self.current_turn);
            self.consecutive_sixes = 0;
            self.dice_roll = 0;
            self.next_turn();
            return 6;
        }

        self.last_action = format!("Player {} rolled a {}", self.current_turn, roll);

        // Check if current player has any valid moves
        if self.get_valid_tokens().is_empty() {
            self.last_action.push_str(" (No valid moves available)");
        }

        self.dice_roll
    }

    pub fn get_valid_tokens(&self) -> Vec<u8> {
        if self.dice_roll == 0 || self.is_game_over {
            return Vec::new();
        }

        let current_color = PlayerColor::from_idx(self.current_turn);
        let mut valid_token_ids = Vec::new();

        // In 2v2 Team Mode: If player's own pieces are all finished, player can move teammate's pieces!
        let own_tokens_finished = self.tokens.iter()
            .filter(|t| t.color == current_color)
            .all(|t| t.is_finished());

        let target_color = if self.is_team_mode && own_tokens_finished {
            let teammate_idx = (self.current_turn + 2) % 4;
            PlayerColor::from_idx(teammate_idx)
        } else {
            current_color
        };

        for token in &self.tokens {
            if token.color != target_color || token.is_finished() {
                continue;
            }

            if token.is_at_base() {
                if self.dice_roll == 6 {
                    valid_token_ids.push(token.id);
                }
            } else {
                let target_steps = token.steps_taken + self.dice_roll;
                if target_steps <= 57 {
                    valid_token_ids.push(token.id);
                }
            }
        }

        valid_token_ids
    }

    pub fn move_token(&mut self, token_id: u8) -> bool {
        if self.dice_roll == 0 || self.is_game_over {
            return false;
        }

        let valid_tokens = self.get_valid_tokens();
        if !valid_tokens.contains(&token_id) {
            return false;
        }

        let current_player = self.current_turn;
        let roll = self.dice_roll;
        let mut extra_turn = roll == 6;

        let token_idx = self.tokens.iter().position(|t| t.id == token_id).unwrap();
        let color = self.tokens[token_idx].color;

        if self.tokens[token_idx].is_at_base() {
            // Spawn token to start position
            let start_pos = color.start_track_index() as i16;
            self.tokens[token_idx].position = start_pos;
            self.tokens[token_idx].steps_taken = 1;
            self.last_action = format!("Player {} spawned token {} onto board", current_player, token_id);
        } else {
            let new_steps = self.tokens[token_idx].steps_taken + roll;
            if new_steps == 57 {
                // Reached home!
                self.tokens[token_idx].position = 999;
                self.tokens[token_idx].steps_taken = 57;
                self.last_action = format!("Player {} token {} reached home!", current_player, token_id);
                extra_turn = true; // Bonus turn for completing a pawn
            } else if new_steps > 51 {
                // In home stretch
                let stretch_idx = (new_steps - 51) as u16;
                self.tokens[token_idx].position = (color.home_stretch_base() + stretch_idx) as i16;
                self.tokens[token_idx].steps_taken = new_steps;
                self.last_action = format!("Player {} token {} moved into home stretch", current_player, token_id);
            } else {
                // On main track
                let new_track_pos = ((color.start_track_index() as u16 + new_steps as u16 - 1) % 52) as i16;
                self.tokens[token_idx].position = new_track_pos;
                self.tokens[token_idx].steps_taken = new_steps;

                // Check captures on non-safe tiles
                if !is_safe_zone(new_track_pos as u8) {
                    let target_pos = new_track_pos;
                    let mut captured = false;

                    let is_teammate = |c1: PlayerColor, c2: PlayerColor| -> bool {
                        if !self.is_team_mode {
                            return c1 == c2;
                        }
                        (c1 as u8 % 2) == (c2 as u8 % 2)
                    };

                    // Count friendly tokens (same color or teammate color in 2v2 mode) at target_pos
                    let friendly_count = self.tokens.iter().filter(|t| {
                        is_teammate(t.color, color)
                            && t.position == target_pos
                            && !t.is_at_base()
                            && !t.is_finished()
                    }).count();

                    // Check opponent colors present at target_pos: capture only if friendly_count >= opp_count
                    let mut captured_colors = Vec::new();
                    for opp_color in [PlayerColor::Red, PlayerColor::Green, PlayerColor::Yellow, PlayerColor::Blue] {
                        if is_teammate(opp_color, color) {
                            continue;
                        }
                        let opp_count = self.tokens.iter().filter(|t| {
                            t.color == opp_color
                                && t.position == target_pos
                                && !t.is_at_base()
                                && !t.is_finished()
                        }).count();

                        if opp_count > 0 && friendly_count >= opp_count {
                            captured_colors.push(opp_color);
                        }
                    }

                    if !captured_colors.is_empty() {
                        for other_token in &mut self.tokens {
                            if captured_colors.contains(&other_token.color)
                                && other_token.position == target_pos
                                && !other_token.is_at_base()
                                && !other_token.is_finished()
                            {
                                other_token.position = -1;
                                other_token.steps_taken = 0;
                                captured = true;
                                self.last_action = format!(
                                    "Player {} captured Player {:?}'s stack!",
                                    current_player, other_token.color
                                );
                            }
                        }
                    }

                    if captured {
                        extra_turn = true; // Bonus turn for capture
                    }
                }
            }
        }

        // Check player/team completion status
        let target_p_idx = color as u8;
        if self.is_player_finished(target_p_idx) && !self.winners_rank.contains(&target_p_idx) {
            self.winners_rank.push(target_p_idx);
            if self.winner.is_none() {
                self.winner = Some(target_p_idx);
            }

            let rank = self.winners_rank.len();
            let rank_names = ["1st 👑", "2nd 🥈", "3rd 🥉", "4th"];
            let r_name = rank_names.get(rank - 1).unwrap_or(&"Finished");
            let turn_colors = ["Red", "Green", "Yellow", "Blue"];

            self.last_action = format!(
                "👑 {} HAS FINISHED IN {} PLACE! Match continues for remaining players...",
                turn_colors[target_p_idx as usize], r_name
            );

            // Check if match is fully complete (all players finished, or only 1 active remaining)
            let active_remaining = (0..self.num_players)
                .filter(|&p| !self.is_player_finished(p))
                .count();

            if active_remaining <= 1 {
                self.is_game_over = true;
                self.dice_roll = 0;
                let champ_idx = self.winners_rank[0] as usize;
                self.last_action = format!(
                    "🎉 MATCH COMPLETE! {} is the 👑 Champion!",
                    turn_colors[champ_idx]
                );
                return true;
            }
        }

        // Reset dice roll for next action
        self.dice_roll = 0;

        if !extra_turn {
            self.next_turn();
        } else {
            self.last_action.push_str(" (Bonus turn!)");
        }

        true
    }

    fn next_turn(&mut self) {
        self.dice_roll = 0;
        if self.is_game_over {
            return;
        }

        let mut count = 0;
        while count < self.num_players {
            self.current_turn = (self.current_turn + 1) % self.num_players;
            count += 1;

            if !self.is_player_finished(self.current_turn) {
                break;
            }
        }
    }

    pub fn is_player_finished(&self, player_idx: u8) -> bool {
        let color = PlayerColor::from_idx(player_idx);
        let own_finished = self.tokens.iter().filter(|t| t.color == color).all(|t| t.is_finished());

        if self.is_team_mode && own_finished {
            let teammate_color = PlayerColor::from_idx((player_idx + 2) % 4);
            let teammate_finished = self.tokens.iter().filter(|t| t.color == teammate_color).all(|t| t.is_finished());
            return teammate_finished;
        }

        own_finished
    }

    fn check_winner(&self, player_idx: u8) -> bool {
        self.is_player_finished(player_idx)
<<<<<<< HEAD
    }

    pub fn select_best_ai_move(&self) -> Option<u8> {
        let valid_tokens = self.get_valid_tokens();
        if valid_tokens.is_empty() {
            return None;
        }

        let roll = self.dice_roll;
        let mut best_token_id = valid_tokens[0];
        let mut max_score = i32::MIN;

        let is_teammate = |c1: PlayerColor, c2: PlayerColor| -> bool {
            if !self.is_team_mode {
                c1 == c2
            } else {
                (c1 as u8 % 2) == (c2 as u8 % 2)
            }
        };

        for &token_id in &valid_tokens {
            let mut score: i32 = 0;
            let token = self.tokens.iter().find(|t| t.id == token_id).unwrap();
            let color = token.color;

            let start_track = color.start_track_index();

            // 1. Spawning out of base
            if token.is_at_base() {
                let active_on_track = self.tokens.iter()
                    .filter(|t| t.color == color && !t.is_at_base() && !t.is_finished())
                    .count();

                if active_on_track == 0 {
                    score += 450; // High priority to get 1st piece out!
                } else if active_on_track < 3 {
                    score += 280; // Bring more pieces onto board
                } else {
                    score += 150;
                }
            } else {
                let new_steps = token.steps_taken + roll;

                // 2. Reaching Home finish (57)
                if new_steps == 57 {
                    score += 1200; // TOP PRIORITY: Complete piece into home!
                } else if new_steps > 51 {
                    // Moving inside home stretch
                    score += 400 + (new_steps as i32) * 5;
                } else {
                    // On main track
                    let new_pos = ((start_track as u16 + new_steps as u16 - 1) % 52) as i16;

                    // 3. Capturing opponent pieces/stacks
                    if !is_safe_zone(new_pos as u8) {
                        let opp_count: usize = self.tokens.iter().filter(|t| {
                            !is_teammate(t.color, color)
                                && t.position == new_pos
                                && !t.is_at_base()
                                && !t.is_finished()
                        }).count();

                        let friendly_count: usize = self.tokens.iter().filter(|t| {
                            is_teammate(t.color, color)
                                && t.position == new_pos
                                && !t.is_at_base()
                                && !t.is_finished()
                        }).count();

                        if opp_count > 0 && (friendly_count + 1) >= opp_count {
                            score += 1000 + (opp_count as i32) * 150; // CRITICAL ATTACK BONUS!
                        }
                    }

                    // 4. Safe zone landing
                    if is_safe_zone(new_pos as u8) {
                        score += 450;
                    }

                    // 5. Creating or joining a friendly stack (Blockade / Jora)
                    let existing_friendly_on_tile = self.tokens.iter().filter(|t| {
                        t.color == color
                            && t.id != token_id
                            && t.position == new_pos
                    }).count();

                    if existing_friendly_on_tile > 0 {
                        score += 380; // Form a solid stack!
                    }

                    // 6. Escaping current danger (was token threatened by an opponent within 1..6 tiles behind?)
                    let curr_pos = token.position;
                    let mut was_in_danger = false;
                    for opp in &self.tokens {
                        if !is_teammate(opp.color, color) && opp.position >= 0 && opp.position < 52 {
                            let dist = (curr_pos - opp.position + 52) % 52;
                            if dist >= 1 && dist <= 6 {
                                was_in_danger = true;
                                break;
                            }
                        }
                    }

                    if was_in_danger && (is_safe_zone(new_pos as u8) || existing_friendly_on_tile > 0) {
                        score += 550; // Escape from danger to safety!
                    }

                    // 7. Avoid landing in immediate danger (opponent 1..6 tiles behind target tile)
                    if !is_safe_zone(new_pos as u8) && existing_friendly_on_tile == 0 {
                        for opp in &self.tokens {
                            if !is_teammate(opp.color, color) && opp.position >= 0 && opp.position < 52 {
                                let dist = (new_pos - opp.position + 52) % 52;
                                if dist >= 1 && dist <= 6 {
                                    score -= 300; // Threat penalty!
                                    break;
                                }
                            }
                        }
                    }

                    // 8. General track progression
                    score += token.steps_taken as i32;
                }
            }

            if score > max_score {
                max_score = score;
                best_token_id = token_id;
            }
        }

        Some(best_token_id)
=======
>>>>>>> main
    }
}
