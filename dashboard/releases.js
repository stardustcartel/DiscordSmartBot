function setHelpExpanded(expanded) {
  document.querySelector("#help-tab").setAttribute("aria-expanded", String(expanded));
  document.querySelector("#help-tab").classList.toggle("expanded", expanded);
  document.querySelector("#version-history-tab").hidden = !expanded;
  document.querySelector("#support-tab").hidden = !expanded;
  requestAnimationFrame(() => updateMobileNavHint());
}
async function loadVersionHistory() {
  const list = document.querySelector("#release-list");
  list.textContent = "Loading version history…";
  try {
    const data = await api("/api/releases");
    list.replaceChildren();
    document.querySelector("#release-history-note").hidden = !data.releases.some((item) => item.historical);
    let major;
    for (const item of data.releases) {
      const group = item.version.split(".")[0];
      if (group !== major) { const heading = document.createElement("h3"); heading.className = "release-major"; heading.textContent = `${group}.0`; list.append(heading); major = group; }
      const entry = document.createElement("article"); entry.className = "release-entry";
      entry.classList.toggle("release-highlighted", Boolean(item.highlighted));
      const header = document.createElement("div"); header.className = "release-heading";
      const version = document.createElement("strong"); version.textContent = `v${item.version}`;
      const date = document.createElement("time"); date.dateTime = item.at;
      date.textContent = item.at ? `${item.historical ? "Recorded" : "Released"} ${new Date(item.at).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}` : "Deployment in progress";
      header.append(version, date);
      const content = document.createElement("div"); content.className = "release-content";
      const renderText = () => {
        content.replaceChildren();
        for (const line of item.changes) { const paragraph = document.createElement("p"); paragraph.textContent = line; content.append(paragraph); }
      };
      const actions = document.createElement("div"); actions.className = "release-actions";
      if (data.canEdit) {
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "release-tool release-edit";
        edit.title = `Edit v${item.version}`; edit.setAttribute("aria-label", edit.title);
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(icon.namespaceURI, "path"); path.setAttribute("d", "M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"); icon.append(path); edit.append(icon);
        edit.onclick = () => {
          edit.disabled = true;
          const form = document.createElement("form"); form.className = "release-editor";
          const label = document.createElement("label"); label.textContent = "Update text (one paragraph per line)";
          const input = document.createElement("textarea"); input.value = item.changes.join("\n"); input.maxLength = 6000; input.required = true; label.append(input);
          const note = document.createElement("small"); note.className = "field-help"; note.textContent = "The original version and release timestamp will stay unchanged.";
          const buttons = document.createElement("div"); buttons.className = "behavior-actions";
          const save = document.createElement("button"); save.type = "submit"; save.className = "button"; save.textContent = "Save update";
          const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button release-cancel"; cancel.textContent = "Cancel";
          const error = document.createElement("p"); error.className = "release-error"; error.setAttribute("role", "alert"); error.hidden = true;
          const lines = () => input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          const updateSave = () => { const value = lines(); save.disabled = !value.length || value.length > 12 || value.some(line => line.length > 1500) || JSON.stringify(value) === JSON.stringify(item.changes); };
          const close = () => { renderText(); edit.disabled = false; edit.focus(); };
          cancel.onclick = close;
          input.oninput = updateSave;
          form.onkeydown = event => { if (event.key === "Escape" && !input.disabled) { event.preventDefault(); close(); } };
          form.onsubmit = async event => {
            event.preventDefault(); if (save.disabled) return;
            save.disabled = true; cancel.disabled = true; input.disabled = true; error.hidden = true;
            try {
              const result = await api("/api/releases", { method: "PATCH", body: JSON.stringify({ version: item.version, changes: lines() }) });
              item.changes = result.changes; close(); toast("Version history text saved.");
            } catch (failure) { error.textContent = failure.message; error.hidden = false; input.disabled = false; cancel.disabled = false; updateSave(); }
          };
          buttons.append(save, cancel); form.append(label, note, buttons, error); content.replaceChildren(form); updateSave(); input.focus();
        };
        const star = document.createElement("button"); star.type = "button"; star.className = "release-tool release-star";
        const updateStar = () => { star.textContent = item.highlighted ? "★" : "☆"; star.setAttribute("aria-pressed", String(Boolean(item.highlighted))); star.title = `${item.highlighted ? "Unhighlight" : "Highlight"} v${item.version}`; star.setAttribute("aria-label", star.title); };
        updateStar();
        star.onclick = async () => {
          star.disabled = true;
          try {
            const result = await api("/api/releases", { method: "PATCH", body: JSON.stringify({ version: item.version, highlighted: !item.highlighted }) });
            item.highlighted = result.highlighted; entry.classList.toggle("release-highlighted", item.highlighted); updateStar();
          } catch (error) { toast(error.message); }
          finally { star.disabled = false; }
        };
        actions.append(edit, star);
      }
      if (data.canDelete) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "release-remove"; remove.textContent = "−"; remove.setAttribute("aria-label", `Delete v${item.version} from version history`);
        remove.onclick = async () => {
          if (!confirm(`Delete the v${item.version} entry from Version History for everyone? This does not undo the software update.`)) return;
          remove.disabled = true;
          try { await api("/api/releases", { method: "DELETE", body: JSON.stringify({ version: item.version }) }); toast("Version history entry removed."); await loadVersionHistory(); }
          catch (error) { toast(error.message); remove.disabled = false; }
        };
        actions.append(remove);
      }
      if (actions.children.length) header.append(actions);
      entry.append(header, content); renderText();
      list.append(entry);
    }
    if (!data.releases.length) list.textContent = "No version history entries to display.";
  } catch (error) { list.textContent = error.message || "Version history could not be loaded."; }
}
