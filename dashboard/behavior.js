let approvedDrafts = [];
const answerFields = (items) => (items || []).map(({ id, question, answer, url }) => ({ id, question: question.trim(), answer: answer.trim(), url: url || "" }));
function updateBehaviorSaveButtons() {
  const ready = Boolean(selected && settingsLoadedGuild === selected);
  const rules = document.querySelector("#rules-form");
  if (!rules) return;
  rules.querySelector("button[type=submit]").disabled = !ready || rules.getAttribute("aria-busy") === "true" || rules.rules.value.trim() === (settings.rules || "");
  const form = document.querySelector("#approved-answers-form");
  const valid = approvedDrafts.length <= 40 && approvedDrafts.every((item) => item.question.trim() && item.answer.trim()) && approvedDrafts.reduce((n, item) => n + item.question.trim().length + item.answer.trim().length, 0) <= 24000;
  form.querySelector("button[type=submit]").disabled = !ready || !valid || form.getAttribute("aria-busy") === "true" || JSON.stringify(answerFields(approvedDrafts)) === JSON.stringify(answerFields(settings.approvedAnswers));
  document.querySelector("#add-approved-answer").disabled = !ready || approvedDrafts.length >= 40 || form.getAttribute("aria-busy") === "true";
  document.querySelector("#approved-answer-count").textContent = `${approvedDrafts.length} of 40 answers · ${approvedDrafts.reduce((n, item) => n + item.question.length + item.answer.length, 0).toLocaleString()} / 24,000 characters`;
}
function renderApprovedAnswers() {
  const container = document.querySelector("#approved-answer-list");
  container.replaceChildren();
  if (!approvedDrafts.length) {
    const empty = document.createElement("p"); empty.className = "hint"; empty.textContent = "No approved answers yet. Add the information your server's admins want the bot to rely on."; container.append(empty);
  }
  for (const item of approvedDrafts) {
    const card = document.createElement("fieldset"); card.className = "approved-answer-card";
    const legend = document.createElement("legend"); legend.textContent = `Answer ${approvedDrafts.indexOf(item) + 1}`; card.append(legend);
    for (const [name, title, max] of [["question", "Question or topic", 500], ["answer", "Approved answer", 4000], ["url", "Resource link (optional)", 1500]]) {
      const label = document.createElement("label"); label.textContent = title;
      const input = document.createElement(name === "answer" ? "textarea" : "input");
      input.value = item[name] || ""; input.maxLength = max; input.required = name !== "url";
      if (name === "url") { input.type = "url"; input.placeholder = "https://…"; input.pattern = "https://.*"; }
      input.addEventListener("input", () => { item[name] = input.value; updateBehaviorSaveButtons(); });
      label.append(input); card.append(label);
    }
    if (item.updatedAt) { const stamp = document.createElement("small"); stamp.className = "field-help"; stamp.textContent = `Last saved ${new Date(item.updatedAt).toLocaleString()}`; card.append(stamp); }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "behavior-remove"; remove.textContent = "Remove answer";
    remove.onclick = () => { if (item.updatedAt && !confirm("Remove this approved answer? Click Save approved answers to apply the removal.")) return; approvedDrafts = approvedDrafts.filter((answer) => answer.id !== item.id); renderApprovedAnswers(); updateBehaviorSaveButtons(); };
    card.append(remove); container.append(card);
  }
}
function loadBehaviorFields() {
  document.querySelector("#rules-form").rules.value = settings.rules || "";
  approvedDrafts = structuredClone(settings.approvedAnswers || []);
  renderApprovedAnswers(); updateBehaviorSaveButtons();
}
function setupBehavior() {
  document.querySelector("#add-approved-answer").onclick = () => {
    if (approvedDrafts.length >= 40) return;
    approvedDrafts.push({ id: crypto.randomUUID(), question: "", answer: "", url: "" });
    renderApprovedAnswers(); updateBehaviorSaveButtons();
    document.querySelector("#approved-answer-list fieldset:last-child input")?.focus();
  };
  for (const [id, key] of [["rules-form", "rules"], ["approved-answers-form", "approvedAnswers"]]) {
    const form = document.getElementById(id);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!selected || form.getAttribute("aria-busy") === "true") return;
      const guildId = selected;
      const value = key === "rules" ? form.rules.value.trim() : answerFields(approvedDrafts);
      form.setAttribute("aria-busy", "true"); form.inert = true; updateBehaviorSaveButtons();
      try {
        const result = await api(`/api/guild/${guildId}/behavior`, { method: "PUT", body: JSON.stringify({ [key]: value }) });
        if (selected !== guildId) return;
        settings[key] = result[key];
        if (key === "rules") form.rules.value = result.rules;
        else { approvedDrafts = structuredClone(result.approvedAnswers); renderApprovedAnswers(); }
        toast(key === "rules" ? "Rules saved." : "Approved answers saved.");
      } catch (error) { toast(error.message); }
      finally { form.removeAttribute("aria-busy"); form.inert = false; updateBehaviorSaveButtons(); }
    };
  }
}
