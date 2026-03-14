use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

mod tray;

/// Sidecar 子进程状态
struct SidecarState {
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

/// 获取用户数据目录
fn get_data_dir() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("agentclaw")
}

/// 启动 gateway sidecar
fn start_sidecar(app: &tauri::AppHandle) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    let data_dir = get_data_dir();
    // 确保数据目录存在
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let config_path = data_dir.join("config.json");

    let sidecar = app
        .shell()
        .sidecar("agentclaw-server")
        .map_err(|e: tauri_plugin_shell::Error| e.to_string())?
        .env("CONFIG_PATH", config_path.to_string_lossy().to_string())
        .env("DB_PATH", data_dir.join("agentclaw.db").to_string_lossy().to_string())
        .env("SKILLS_DIR", data_dir.join("skills").to_string_lossy().to_string())
        .env("HOST", "127.0.0.1")
        .env("PORT", "3100");

    let (mut rx, child) = sidecar.spawn().map_err(|e: tauri_plugin_shell::Error| e.to_string())?;

    // 后台打印 sidecar 输出
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line);
                    println!("[gateway] {}", s);
                }
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line);
                    eprintln!("[gateway] {}", s);
                }
                CommandEvent::Terminated(status) => {
                    println!("[gateway] 进程退出: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Tauri 命令：检查 sidecar 是否运行中
#[tauri::command]
fn is_gateway_running(state: tauri::State<'_, Mutex<SidecarState>>) -> bool {
    state.lock().unwrap().child.is_some()
}

/// Tauri 命令：获取数据目录路径
#[tauri::command]
fn get_data_path() -> String {
    get_data_dir().to_string_lossy().to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState { child: None }))
        .invoke_handler(tauri::generate_handler![is_gateway_running, get_data_path])
        .setup(|app| {
            // 创建系统托盘
            tray::create_tray(app.handle())?;

            // 启动 sidecar
            let handle = app.handle().clone();
            match start_sidecar(&handle) {
                Ok(child) => {
                    let state = handle.state::<Mutex<SidecarState>>();
                    state.lock().unwrap().child = Some(child);
                    println!("[desktop] Gateway sidecar 已启动");
                }
                Err(e) => {
                    eprintln!("[desktop] 启动 sidecar 失败: {}，将以配置模式运行", e);
                    // 不阻止应用启动 - 用户可以先配置再启动
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口时最小化到托盘而不是退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap_or_default();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 AgentClaw 失败");
}
