use crate::app_state::CloseBehavior;
use crate::commands::app_commands::{close_behavior_to_str, parse_close_behavior};

#[test]
fn parse_close_behavior_defaults_to_hide_to_tray() {
    assert_eq!(parse_close_behavior(""), CloseBehavior::HideToTray);
    assert_eq!(parse_close_behavior("unexpected"), CloseBehavior::HideToTray);
    assert_eq!(parse_close_behavior("hide_to_tray"), CloseBehavior::HideToTray);
}

#[test]
fn parse_close_behavior_accepts_exit_case_insensitively() {
    assert_eq!(parse_close_behavior("exit"), CloseBehavior::Exit);
    assert_eq!(parse_close_behavior("EXIT"), CloseBehavior::Exit);
    assert_eq!(parse_close_behavior("ExIt"), CloseBehavior::Exit);
}

#[test]
fn close_behavior_to_str_preserves_wire_contract() {
    assert_eq!(close_behavior_to_str(CloseBehavior::HideToTray), "hide_to_tray");
    assert_eq!(close_behavior_to_str(CloseBehavior::Exit), "exit");
}