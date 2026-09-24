/* Портфолио Данилы Аринова — интерактив */
(function () {
  "use strict";

  /* ---------- Фото из профиля GitHub (обновляется автоматически) ---------- */
  var img = document.getElementById("avatar");
  if (img) {
    // Метка на текущие сутки — сброс кэша, чтобы новое фото подхватывалось сразу
    var stamp = new Date().toISOString().slice(0, 10);
    img.src = "https://github.com/TeivrimOriginal.png?v=" + stamp;
    img.onerror = function () {
      img.onerror = null;
      img.src = "https://avatars.githubusercontent.com/u/174201371?v=4";
    };
  }

  /* ---------- Появление блоков при прокрутке ---------- */
  var els = document.querySelectorAll(".hero-l, .hero-r, .rows, .grid, .c-grid");
  if ("IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("vis");
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    els.forEach(function (el) {
      el.classList.add("rv");
      obs.observe(el);
    });
  } else {
    els.forEach(function (el) { el.classList.add("vis"); });
  }

  /* ---------- Удаление проекта ---------- */
  var KEY = "portfolio_hidden_projects_v1";
  var hidden = new Set();

  try {
    JSON.parse(localStorage.getItem(KEY) || "[]").forEach(function (n) { hidden.add(n); });
  } catch (e) { /* повреждённые данные игнорируем */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(Array.from(hidden))); } catch (e) {}
  }

  document.querySelectorAll(".pc").forEach(function (card) {
    var name = (card.querySelector("h3") || {}).textContent || "";

    if (name && hidden.has(name)) { card.style.display = "none"; return; }

    var b = document.createElement("button");
    b.type = "button";
    b.className = "del";
    b.title = "Удалить проект";
    b.setAttribute("aria-label", "Удалить проект");
    b.textContent = "✕";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (name) { hidden.add(name); save(); }
      card.style.display = "none";
    });
    card.appendChild(b);
  });
})();
