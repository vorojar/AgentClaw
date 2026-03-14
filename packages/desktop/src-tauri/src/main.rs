// 防止 Windows 下显示控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    agentclaw_desktop_lib::run()
}
