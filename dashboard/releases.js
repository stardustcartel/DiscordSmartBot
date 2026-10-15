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
      const header = document.createElement("div"); header.className = "release-heading";
      const version = document.createElement("strong"); version.textContent = `v${item.version}`;
      const date = document.createElement("time"); date.dateTime = item.at;
      date.textContent = item.at ? `${item.historical ? "Recorded" : "Released"} ${new Date(item.at).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}` : "Deployment in progress";
      header.append(version, date);
      if (data.canDelete) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "release-remove"; remove.textContent = "−"; remove.setAttribute("aria-label", `Delete v${item.version} from version history`);
        remove.onclick = async () => {
          if (!confirm(`Delete the v${item.version} entry from Version History for everyone? This does not undo the software update.`)) return;
          remove.disabled = true;
          try { await api("/api/releases", { method: "DELETE", body: JSON.stringify({ version: item.version }) }); toast("Version history entry removed."); await loadVersionHistory(); }
          catch (error) { toast(error.message); remove.disabled = false; }
        };
        header.append(remove);
      }
      entry.append(header);
      for (const line of item.changes) { const paragraph = document.createElement("p"); paragraph.textContent = line; entry.append(paragraph); }
      list.append(entry);
    }
    if (!data.releases.length) list.textContent = "No version history entries to display.";
  } catch (error) { list.textContent = error.message || "Version history could not be loaded."; }
}
