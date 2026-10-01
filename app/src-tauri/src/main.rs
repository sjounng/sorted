// 배포 빌드에서 Windows 콘솔 창이 뜨지 않게 한다 (macOS에는 영향 없음).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sorted_lib::run()
}
