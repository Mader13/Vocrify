use std::sync::{Arc, Mutex};

pub fn get_current_model(current_model: &Arc<Mutex<Option<String>>>) -> Option<String> {
    current_model.lock().unwrap().clone()
}

pub fn is_model_loaded(current_model: &Arc<Mutex<Option<String>>>) -> bool {
    current_model.lock().unwrap().is_some()
}

pub fn set_current_model_name(current_model: &Arc<Mutex<Option<String>>>, model_name: &str) {
    let mut current = current_model.lock().unwrap();
    *current = Some(model_name.to_string());
}

pub fn current_model_name(current_model: &Arc<Mutex<Option<String>>>) -> Option<String> {
    current_model.lock().unwrap().as_ref().cloned()
}