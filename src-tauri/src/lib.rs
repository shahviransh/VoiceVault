mod rag;

use rag::RagState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data)?;

            let rag = RagState::initialize(&app_data).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            })?;
            app.manage(rag);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rag::ingest_document,
            rag::update_profile_facts,
            rag::retrieve_context_cmd,
            rag::list_documents,
            rag::delete_document,
            rag::get_prep_metadata,
            rag::get_profile_facts,
            rag::offline_status,
            rag::get_proof_point,
            rag::save_practice_session,
            rag::list_practice_sessions,
            rag::export_session_md,
            rag::set_embedding_prefs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoiceVault");
}
