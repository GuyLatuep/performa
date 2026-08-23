/** "4.2 MB" — an attachment's size at a glance.
 *
 *  Binary units under decimal names, which is what every file manager shows
 *  and therefore what a size is compared against. One decimal place below
 *  10 units and none above: "9.4 MB" is worth the digit, "412 MB" is not.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
