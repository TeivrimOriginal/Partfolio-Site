const avatar = document.getElementById("avatar");

if (avatar) {
  const today = new Date().toISOString().slice(0, 10);
  avatar.src = `https://github.com/TeivrimOriginal.png?v=${today}`;

  avatar.addEventListener("error", () => {
    avatar.src = "https://avatars.githubusercontent.com/u/174201371?v=4";
  }, { once: true });
}

const STORE = "portfolio_hidden_projects_v1";
const hidden = new Set();

try {
  for (const name of JSON.parse(localStorage.getItem(STORE) || "[]")) hidden.add(name);
} catch {}

const remember = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify([...hidden]));
  } catch {}
};

for (const card of document.querySelectorAll(".work")) {
  const title = card.querySelector("h3")?.textContent.trim();

  if (title && hidden.has(title)) {
    card.style.display = "none";
    continue;
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "del";
  remove.title = "Удалить проект";
  remove.setAttribute("aria-label", "Удалить проект");
  remove.textContent = "✕";

  remove.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (title) {
      hidden.add(title);
      remember();
    }

    card.style.display = "none";
  });

  card.append(remove);
}
