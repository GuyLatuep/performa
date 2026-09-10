/** Whether the window behind this webview is a vibrancy surface.
 *
 *  Only macOS gets one: `tauri.macos.conf.json` makes the window transparent
 *  and puts an NSVisualEffectView behind it, which is the licensed way to have
 *  the real material rather than a blur painted in CSS. Windows is left alone
 *  deliberately — Mica needs Windows 11, and a transparent window on Windows 10
 *  with no effect applied is just a see-through window.
 *
 *  The platform is read off the user agent rather than through a plugin: this
 *  decides which CSS to apply, so being wrong costs a background colour, and
 *  it is not worth a dependency and an async call before first paint.
 */
export function isVibrancyPlatform(): boolean {
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}

/** Mark the document so the vibrancy rules in App.css apply. Without the mark
 *  every surface stays opaque, which is what every other platform wants. */
export function applyVibrancy(): void {
  if (isVibrancyPlatform()) {
    document.documentElement.setAttribute("data-vibrancy", "on");
  }
}
