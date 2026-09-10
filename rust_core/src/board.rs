use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerColor {
    Red = 0,
    Green = 1,
    Yellow = 2,
    Blue = 3,
}

impl PlayerColor {
    pub fn from_idx(idx: u8) -> Self {
        match idx % 4 {
            0 => PlayerColor::Red,
            1 => PlayerColor::Green,
            2 => PlayerColor::Yellow,
            _ => PlayerColor::Blue,
        }
    }

    pub fn start_track_index(&self) -> u8 {
        match self {
            PlayerColor::Red => 0,
            PlayerColor::Green => 13,
            PlayerColor::Yellow => 26,
            PlayerColor::Blue => 39,
        }
    }

    pub fn home_entry_index(&self) -> u8 {
        match self {
            PlayerColor::Red => 50,
            PlayerColor::Green => 11,
            PlayerColor::Yellow => 24,
            PlayerColor::Blue => 37,
        }
    }

    pub fn home_stretch_base(&self) -> u16 {
        match self {
            PlayerColor::Red => 100,
            PlayerColor::Green => 200,
            PlayerColor::Yellow => 300,
            PlayerColor::Blue => 400,
        }
    }
}

pub fn is_safe_zone(tile_idx: u8) -> bool {
    matches!(tile_idx, 0 | 8 | 13 | 21 | 26 | 34 | 39 | 47)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Token {
    pub id: u8,
    pub color: PlayerColor,
    pub position: i16, // -1: Base, 0..51: Track, 100..105: Red Stretch, 200..205: Green, 300..305: Yellow, 400..405: Blue, 999: Finished
    pub steps_taken: u8, // max 57 steps to finish
}

impl Token {
    pub fn new(id: u8, color: PlayerColor) -> Self {
        Self {
            id,
            color,
            position: -1,
            steps_taken: 0,
        }
    }

    pub fn is_at_base(&self) -> bool {
        self.position == -1
    }

    pub fn is_finished(&self) -> bool {
        self.position == 999 || self.steps_taken == 57
    }
}
