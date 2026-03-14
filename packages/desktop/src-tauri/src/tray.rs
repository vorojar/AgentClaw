use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};

pub fn create_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "打开主窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()?;

    let icon = app.default_window_icon().cloned()
        .ok_or("No default icon")?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("AgentClaw")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.show().unwrap_or_default();
                        window.set_focus().unwrap_or_default();
                    }
                }
                "quit" => {
                    // 停止 sidecar
                    let state = app.state::<std::sync::Mutex<super::SidecarState>>();
                    if let Some(child) = state.lock().unwrap().child.take() {
                        let _ = child.kill();
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
