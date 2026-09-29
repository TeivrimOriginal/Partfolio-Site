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

const restore = document.querySelector(".restore");

/* Hides the projects the visitor removed and puts a delete control on the rest.
   Re-run after a restore so the cards that come back get their control too. */
const syncRemoved = () => {
  for (const card of document.querySelectorAll(".work")) {
    const title = card.querySelector("h3")?.textContent.trim();

    if (title && hidden.has(title)) {
      card.style.display = "none";
      continue;
    }

    card.style.display = "";

    if (card.querySelector(".del")) continue;

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
      restore.hidden = hidden.size === 0;
    });

    card.append(remove);
  }
};

syncRemoved();

/* Tag filters. Cards are toggled with a class instead of an inline style, so a
   card the visitor removed stays hidden whichever filter is active. */
const filterButtons = document.querySelectorAll(".filters button[data-filter]");

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    const wanted = button.dataset.filter;

    for (const other of filterButtons) {
      other.setAttribute("aria-pressed", String(other === button));
    }

    for (const card of document.querySelectorAll(".work[data-tags]")) {
      const tags = (card.dataset.tags || "").split(/\s+/);
      card.classList.toggle("filtered", wanted !== "all" && !tags.includes(wanted));
    }
  });
}

/* Brings back every project the visitor removed. */
if (restore) {
  restore.hidden = hidden.size === 0;

  restore.addEventListener("click", () => {
    hidden.clear();

    try {
      localStorage.removeItem(STORE);
    } catch {}

    restore.hidden = true;
    syncRemoved();
  });
}
