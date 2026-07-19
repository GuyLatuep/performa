//! System tray (macOS menu bar): open the window or quit from anywhere.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager,
};

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open performa", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit performa", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => quit_via_close(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Quit by closing the window (not exiting the process) so the webview's
/// CloseGuard can still intercept when a timer runs or unlogged work pends.
fn quit_via_close(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) => {
            show_main(app);
            let _ = w.close();
        }
        None => app.exit(0),
    }
}
