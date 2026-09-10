// Appearance only: independent of application, audio and network lifecycles.
const root = document.documentElement;
const toggle = document.getElementById("layout-toggle");
const key = "hermes-layout";
function apply(value) {
  const layout = value === "classic" ? "classic" : "studio";
  root.dataset.layout = layout;
  const next = layout === "studio" ? "Classic" : "Studio";
  toggle.textContent = `${next} layout`;
  toggle.setAttribute("aria-label", `Switch to ${next} layout`);
}
let saved;
try {
  saved = localStorage.getItem(key);
} catch {
  // Restricted storage must not prevent the in-memory fallback.
}
apply(saved);
toggle.addEventListener("click", () => {
  apply(root.dataset.layout === "studio" ? "classic" : "studio");
  try {
    localStorage.setItem(key, root.dataset.layout);
  } catch {
    // The current tab still switches immediately.
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === key || event.key === null) apply(event.newValue);
});
