// Tarayıcı confirm() yerine yerel <dialog> onay penceresi (showModal: odak tuzağı, Esc kapatır, arka plan etkisiz).
// Yalnızca "Tamam" düğmesi true döndürür; Vazgeç, Esc ve arka plana tıklama false.
export function confirmDialog(message: string, opts?: { ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm";
    const inner = document.createElement("div");
    const msg = document.createElement("p");
    msg.className = "confirm-msg";
    msg.textContent = message;
    const row = document.createElement("div");
    row.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn ghost";
    cancel.textContent = opts?.cancel ?? "Vazgeç";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = opts?.danger ? "btn danger" : "btn primary";
    ok.textContent = opts?.ok ?? "Tamam";
    row.append(cancel, ok);
    inner.append(msg, row);
    dlg.append(inner);

    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener("close", () => finish(false));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) finish(false); });

    document.body.append(dlg);
    dlg.showModal();
    ok.focus();
  });
}
