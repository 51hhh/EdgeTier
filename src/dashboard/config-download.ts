/** Keep the object URL alive while browsers hand the download to their file manager. */
export function downloadConfig(toml: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([toml], { type: 'application/toml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
