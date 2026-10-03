/* =========================================================
   Тёплый Контур — скрипты демо-сайта.
   Без зависимостей и сборки. Всё, что можно, считается в браузере.
   ========================================================= */
(function () {
  "use strict";

  var TK = window.TK || {};
  var money = new Intl.NumberFormat("ru-RU");
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var rub = function (n) { return money.format(Math.round(n)) + " ₽"; };

  /* ---------- Бургер-меню ---------- */
  function initMenu() {
    var burger = $(".burger"), nav = $(".nav");
    if (!burger || !nav) return;
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { nav.classList.remove("is-open"); burger.setAttribute("aria-expanded", "false"); }
    });
  }

  /* ---------- Лайтбокс галереи ---------- */
  var Lightbox = (function () {
    var box, img, cap, idx = 0, items = [], lastFocus = null;

    function build() {
      box = document.createElement("div");
      box.className = "lightbox";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Просмотр фотографии");
      box.innerHTML =
        '<button class="lightbox__close" type="button" aria-label="Закрыть (Esc)">×</button>' +
        '<button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Предыдущее фото">‹</button>' +
        '<button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Следующее фото">›</button>' +
        '<div><img alt=""><p class="lightbox__cap"></p></div>';
      document.body.appendChild(box);
      img = $("img", box); cap = $(".lightbox__cap", box);
      $(".lightbox__close", box).addEventListener("click", close);
      $(".lightbox__nav--prev", box).addEventListener("click", function () { step(-1); });
      $(".lightbox__nav--next", box).addEventListener("click", function () { step(1); });
      box.addEventListener("click", function (e) { if (e.target === box) close(); });
      document.addEventListener("keydown", function (e) {
        if (!box.classList.contains("is-open")) return;
        if (e.key === "Escape") close();
        if (e.key === "ArrowLeft") step(-1);
        if (e.key === "ArrowRight") step(1);
      });
    }

    function step(d) {
      if (!items.length) return;
      idx = (idx + d + items.length) % items.length;
      render();
    }

    function render() {
      var it = items[idx];
      img.src = it.src; img.alt = it.cap || "";
      cap.textContent = (it.cap || "") + "  (" + (idx + 1) + " из " + items.length + ")";
    }

    function open(list, i) {
      items = list; idx = i || 0; render();
      lastFocus = document.activeElement;
      box.classList.add("is-open");
      document.body.style.overflow = "hidden";
      $(".lightbox__close", box).focus();
    }

    function close() {
      box.classList.remove("is-open");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }

    return { build: build, open: open, close: close };
  })();

  /* ---------- Карточки товаров ---------- */
  function productCard(p) {
    var badge = "";
    if (p.badges && p.badges.indexOf("hit") > -1) badge = '<span class="badge badge--top">Хит продаж</span>';
    if (p.badges && p.badges.indexOf("new") > -1) badge = '<span class="badge badge--new">Новинка</span>';
    return '<article class="card">' +
      '<a class="card__media" href="product.html?p=' + p.slug + '" aria-label="' + p.title + '">' + badge +
      '<img src="' + p.images[0].src + '" alt="' + p.title + '" loading="lazy" width="600" height="450"></a>' +
      '<div class="card__body">' +
      '<h3 class="card__title"><a href="product.html?p=' + p.slug + '">' + p.title + '</a></h3>' +
      '<p class="card__meta">' + p.dims + ' · ' + p.material.split(",")[0] + '</p>' +
      '<div class="card__price"><b>' + rub(p.price) + '</b>' + (p.oldPrice ? '<span>было ' + rub(p.oldPrice) + '</span>' : '<span>с монтажом</span>') + '</div>' +
      '</div>' +
      '<div class="card__foot">' +
      '<a class="btn btn--primary btn--sm" href="product.html?p=' + p.slug + '">Подробнее</a>' +
      '<a class="btn btn--ghost btn--sm" href="#calc" data-calc-from="' + p.title + '">Рассчитать</a>' +
      '</div></article>';
  }

  /* ---------- Главная: популярные позиции ---------- */
  function initHomeCards() {
    var box = $("[data-home-cards]");
    if (!box || !TK.products) return;
    var top = TK.products.slice().sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); }).slice(0, 4);
    box.innerHTML = top.map(productCard).join("");
  }

  /* ---------- Каталог: фильтры + сортировка ---------- */
  function initCatalog() {
    var box = $("[data-catalog]");
    if (!box || !TK.products) return;
    var countEl = $("[data-catalog-count]"), sortEl = $("[data-catalog-sort]"), emptyEl = $("[data-catalog-empty]");

    function state() {
      var f = {
        cat: ($('input[name="f-cat"]:checked') || {}).value || "all",
        mat: ($('input[name="f-mat"]:checked') || {}).value || "all",
        size: ($('input[name="f-size"]:checked') || {}).value || "all",
        price: ($('input[name="f-price"]:checked') || {}).value || "all",
        sort: sortEl ? sortEl.value : "pop"
      };
      return f;
    }

    function pass(p, f) {
      if (f.cat !== "all" && p.category !== f.cat) return false;
      var mat = p.material.toLowerCase();
      if (f.mat === "pine" && mat.indexOf("сосн") === -1) return false;
      if (f.mat === "spruce" && mat.indexOf("ел") === -1) return false;
      if (f.mat === "larch" && mat.indexOf("листв") === -1) return false;
      var len = parseFloat(p.dims) || 0;
      if (f.size === "s" && len > 3) return false;
      if (f.size === "m" && (len < 3 || len > 4)) return false;
      if (f.size === "l" && len < 4) return false;
      if (f.price === "a" && p.price > 30000) return false;
      if (f.price === "b" && (p.price < 30000 || p.price > 60000)) return false;
      if (f.price === "c" && (p.price < 60000 || p.price > 100000)) return false;
      if (f.price === "d" && p.price < 100000) return false;
      return true;
    }

    function render() {
      var f = state();
      var list = TK.products.filter(function (p) { return pass(p, f); });
      var views = TK.metrics && TK.metrics.views ? TK.metrics.views : {};
      list.sort(function (a, b) {
        if (f.sort === "price-asc") return a.price - b.price;
        if (f.sort === "price-desc") return b.price - a.price;
        if (f.sort === "new") return (b.added || "").localeCompare(a.added || "");
        return (views[b.id] || b.popularity || 0) - (views[a.id] || a.popularity || 0);
      });
      box.innerHTML = list.map(productCard).join("");
      if (countEl) countEl.textContent = list.length + " " + plural(list.length, "товар", "товара", "товаров");
      if (emptyEl) emptyEl.style.display = list.length ? "none" : "block";
    }

    function plural(n, one, few, many) {
      var n10 = n % 10, n100 = n % 100;
      if (n10 === 1 && n100 !== 11) return one;
      if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
      return many;
    }

    $$("[data-filters] input").forEach(function (i) { i.addEventListener("change", render); });
    if (sortEl) sortEl.addEventListener("change", render);
    var reset = $("[data-filters-reset]");
    if (reset) reset.addEventListener("click", function () {
      $$("[data-filters] input").forEach(function (i) { if (i.type === "radio") i.checked = i.defaultChecked; });
      render();
    });
    render();
    window.TKCatalog = { render: render };
  }

  /* ---------- Калькулятор ---------- */
  function fillOptions(select, list, valueKey) {
    if (!select) return;
    select.innerHTML = list.map(function (o) {
      var v = valueKey ? o[valueKey] : o.v;
      return '<option value="' + v + '">' + o.label + '</option>';
    }).join("");
  }

  function initCalc() {
    var form = $("[data-calc]");
    if (!form || !TK.calc) return;
    var C = TK.calc;
    fillOptions($("[name=type]", form), C.area);
    fillOptions($("[name=insulation]", form), C.insulation);
    fillOptions($("[name=roof]", form), C.roof);
    fillOptions($("[name=windows]", form), C.windows);
    fillOptions($("[name=doors]", form), C.doors);

    /* Базовая комплектация по умолчанию: утепление 100 мм, профнастил, 2 окна, 1 дверь */
    var setv = function (sel, v) { var el = $(sel, form); if (el) el.value = v; };
    setv("[name=insulation]", "w100");
    setv("[name=roof]", "prof");
    setv("[name=windows]", "2");
    setv("[name=doors]", "1");

    /* Чекбоксы «доп. опции» — на отдельной странице калькулятора */
    var extraBox = $("[data-calc-extras]", form);
    if (extraBox && C.extras) {
      extraBox.innerHTML = C.extras.map(function (o) {
        return '<label class="check"><input type="checkbox" name="extra" value="' + o.v + '" data-add="' + o.add + '"> ' +
          o.label + ' <span class="muted">+ ' + rub(o.add) + '</span></label>';
      }).join("");
    }
    var montageBox = $("[name=montage]", form);
    if (montageBox && !montageBox.checked) montageBox.checked = true;

    var out = $("[data-calc-out]", form);
    var summary = $("[data-calc-summary]");
    var from = $("[data-calc-from]");

    function opt(list, v) {
      for (var i = 0; i < list.length; i++) if (String(list[i].v) === String(v)) return list[i];
      return list[0];
    }

    function calc() {
      var type = opt(C.area, $("[name=type]", form).value);
      var ins = opt(C.insulation, $("[name=insulation]", form).value);
      var roof = opt(C.roof, $("[name=roof]", form).value);
      var win = opt(C.windows, $("[name=windows]", form).value);
      var door = opt(C.doors, $("[name=doors]", form).value);
      var w = parseFloat($("[name=width]", form).value) || 3;
      var d = parseFloat($("[name=depth]", form).value) || 2;
      var km = parseFloat($("[name=km]", form).value) || 0;
      var area = Math.max(C.minArea, w * d);

      var base = type.fixed ? type.fixed : area * type.perM2 + type.add;
      var insAdd = ins.add;
      var roofAdd = roof.add;
      var total = Math.max(9000, base + insAdd + roofAdd + win.add + door.add);

      var delivery = km * C.deliveryPerKm;
      /* Доп. опции и монтаж — только если есть соответствующие поля на странице */
      var extras = $$("[name=extra]:checked", form);
      var extrasAdd = extras.reduce(function (s, el) { return s + (+el.getAttribute("data-add") || 0); }, 0);
      var extrasText = extras.map(function (el) {
        return (el.parentNode.textContent || "").replace(/\s+/g, " ").trim().replace(/\s*\+.*$/, "");
      });
      var montageOn = montageBox ? montageBox.checked : false;
      var montageAdd = montageOn ? C.montage : 0;
      total += extrasAdd + montageAdd;
      /* На полной странице калькулятора доставка входит в итог, на главной — показывается строкой */
      var fullCalc = !!montageBox;
      if (fullCalc) total += delivery;
      /* Скидка показывается явно: иначе при увеличении размера цена «прыгает» вниз */
      var discounted = false;
      if (total > 100000) { total = Math.round(total * C.discount); discounted = true; }

      if (out) {
        var line = [];
        if (extrasText.length) line.push("опции: " + extrasText.join(", "));
        if (montageOn) line.push("монтаж " + rub(C.montage));
        if (delivery) line.push("доставка ~" + rub(delivery));
        if (discounted) line.push("скидка 10% при заказе от 100 000 ₽");
        out.innerHTML = '<div><div class="calc__price">' + rub(total) +
          '<small>предварительная стоимость' +
          (fullCalc ? " с учётом доставки и монтажа" : ", доставка и монтаж считаются отдельно") + '</small></div>' +
          '<p class="calc__hint">Расчёт: ' + area.toFixed(1) + ' м² · утепление ' + ins.label + ' · ' +
          'кровля ' + roof.label + ' · ' + win.label + ' · ' + door.label + '</p>' +
          (line.length ? '<p class="calc__hint">' + line.join(" · ") + '</p>' : "") + '</div>' +
          '<div class="btn-row"><a class="btn btn--primary" href="#request" data-send-calc>Заказать расчёт</a>' +
          '<a class="btn btn--ghost" href="catalog.html">Смотреть каталог</a></div>';
      }
      if (summary) {
        summary.innerHTML = 'Расчёт: <b>' + type.label + '</b>, ' + area.toFixed(1) + ' м², ' +
          ins.label + ', ' + roof.label + ', ' + win.label + ', ' + door.label +
          (extrasText.length ? ', ' + extrasText.join(", ") : "") +
          (montageOn ? ', монтаж' : "") +
          '. Предварительно <b>' + rub(total) + '</b>' +
          (delivery ? ' (включая доставку ' + km + ' км)' : '') + '.';
      }
      form.dataset.total = String(Math.round(total));
      form.dataset.text = type.label + ", " + w + "×" + d + " м (" + area.toFixed(1) + " м²), " + ins.label + ", " +
        roof.label + ", " + win.label + ", " + door.label +
        (extrasText.length ? ", " + extrasText.join(", ") : "") +
        (montageOn ? ", монтаж" : "") + ", предварительно " + rub(total);
      return total;
    }

    form.addEventListener("input", calc);
    form.addEventListener("change", calc);
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    // Клик по «Заказать расчёт» — переносит расчёт в форму заявки
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-send-calc]") : null;
      if (!t) return;
      var req = $("#request");
      if (!req) return;
      var msg = $("[name=comment]", req);
      if (msg && !msg.value) msg.value = "Расчёт с сайта: " + (form.dataset.text || "");
      req.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { var n = $("[name=name]", req); if (n) n.focus({ preventScroll: true }); }, 400);
    });

    // Кнопки «Рассчитать» на карточках товаров
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-calc-from]") : null;
      if (!t || !from) return;
      from.value = t.getAttribute("data-calc-from");
      var calcBlock = $("#calc");
      if (calcBlock) calcBlock.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    calc();
  }

  /* ---------- Форма заявки (демо-режим) ---------- */
  function initForm() {
    var form = $("[data-form]");
    if (!form) return;
    var status = $("[data-form-status]", form.parentNode) || $("[data-form-status]");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("[name=name]", form).value.trim();
      var phone = $("[name=phone]", form).value.trim();
      if (!name || !phone) {
        if (status) { status.className = "form-status form-status--warn"; status.textContent = "Заполните имя и телефон — без них заявку принять нельзя."; }
        return;
      }
      var data = new FormData(form);
      var lines = [];
      data.forEach(function (v, k) { if (v) lines.push(k + ": " + v); });
      var text = "Заявка с сайта «Тёплый Контур»\n" + lines.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
      if (status) {
        status.className = "form-status form-status--ok";
        status.innerHTML = "Заявка собрана: <b>" + name + "</b>, телефон <b>" + phone + "</b>." +
          "<br>В демо-версии она не уходит на сервер, а копируется в буфер обмена и открывает Telegram — " +
          "на боевом сайте здесь стоит обработчик форм (или бота), который пишет вам в Telegram и на почту.";
      }
      var tg = TK.company && TK.company.telegram ? TK.company.telegram : "";
      if (tg) {
        var link = "https://t.me/share/url?url=" + encodeURIComponent(location.href) +
          "&text=" + encodeURIComponent(text.replace(/\n/g, " | "));
        var box = $("[data-form-actions]", form);
        if (box) box.innerHTML = '<a class="btn btn--primary btn--sm" href="' + link + '" target="_blank" rel="noopener">Отправить в Telegram</a>' +
          '<a class="btn btn--ghost btn--sm" href="mailto:' + (TK.company.email || "") +
          '?subject=' + encodeURIComponent("Заявка с сайта") + '&body=' + encodeURIComponent(text) + '">Отправить на почту</a>';
      }
      form.reset();
    });
  }

  /* ---------- Вкладки на карточке товара ---------- */
  function initTabs() {
    $$("[data-tabs]").forEach(function (wrap) {
      var btns = $$("button", wrap), panels = $$("[data-tabpanel]", wrap.parentNode);
      btns.forEach(function (b, i) {
        b.addEventListener("click", function () {
          btns.forEach(function (x, j) { x.setAttribute("aria-selected", j === i ? "true" : "false"); });
          panels.forEach(function (p, j) { p.hidden = j !== i; });
        });
      });
    });
  }

  /* ---------- Карточка товара ---------- */
  function initProductPage() {
    var root = $("[data-product]");
    if (!root || !TK.products) return;
    var slug = new URLSearchParams(location.search).get("p");
    var p = TK.products.filter(function (x) { return x.slug === slug; })[0] || TK.products[0];
    var t;

    document.title = p.title + " — Тёплый Контур";
    t = $("[data-p-title]"); if (t) t.textContent = p.title;
    t = $("[data-p-crumb]"); if (t) t.textContent = p.title;
    t = $("[data-p-price]"); if (t) t.textContent = rub(p.price);
    t = $("[data-p-old]"); if (t) { t.textContent = p.oldPrice ? "было " + rub(p.oldPrice) : ""; t.hidden = !p.oldPrice; }
    t = $("[data-p-desc]");
    if (t) t.textContent = p.title + ": " + p.dims + ", " + p.material.toLowerCase() + ", " +
      p.insulation.toLowerCase() + ". Срок изготовления " + p.terms + ". " + p.delivery + ".";

    var specRows = [
      ["Габариты (Д×Ш×В)", p.dims], ["Площадь", p.area], ["Вес", p.weight],
      ["Материалы", p.material], ["Утепление", p.insulation], ["Кровля", p.roof],
      ["Пол", p.floor], ["Окна", p.windows], ["Двери", p.doors],
      ["Срок изготовления", p.terms], ["Доставка и монтаж", p.delivery]
    ];
    var specBox = $("[data-p-specs]");
    if (specBox) specBox.innerHTML = specRows.map(function (r) {
      return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>";
    }).join("");

    var gallery = $("[data-p-gallery]");
    if (gallery) {
      var main = '<div class="gallery__main" data-gallery-main tabindex="0" role="button" aria-label="Увеличить фотографию">' +
        '<img src="' + p.images[0].src + '" alt="' + p.images[0].cap + '" width="800" height="600">' +
        '<span class="gallery__zoom">Клик — увеличить</span></div>' +
        '<div class="gallery__thumbs">' + p.images.map(function (im, i) {
          return '<button type="button" data-thumb="' + i + '" aria-current="' + (i === 0) + '" aria-label="' + im.cap + '">' +
            '<img src="' + im.src + '" alt="' + im.cap + '" loading="lazy" width="200" height="150"></button>';
        }).join("") + "</div>";
      gallery.innerHTML = main;
      var big = $("[data-gallery-main] img");
      $$("[data-thumb]", gallery).forEach(function (b) {
        b.addEventListener("click", function () {
          var i = +b.getAttribute("data-thumb");
          big.src = p.images[i].src; big.alt = p.images[i].cap;
          $$("[data-thumb]", gallery).forEach(function (x) { x.setAttribute("aria-current", x === b); });
        });
        b.addEventListener("dblclick", function () { Lightbox.open(p.images, +b.getAttribute("data-thumb")); });
      });
      $("[data-gallery-main]", gallery).addEventListener("click", function () {
        var cur = 0;
        $$("[data-thumb]", gallery).forEach(function (x) { if (x.getAttribute("aria-current") === "true") cur = +x.getAttribute("data-thumb"); });
        Lightbox.open(p.images, cur);
      });
    }

    var files = $("[data-p-files]");
    if (files) {
      files.innerHTML = p.files && p.files.length
        ? p.files.map(function (f) { return '<a class="btn btn--ghost btn--sm" href="' + f.href + '" target="_blank" rel="noopener">' + f.name + '</a>'; }).join("")
        : '<span class="muted" style="font-size:14px">Файл КП готовится под этот заказ — пришлём вместе с расчётом.</span>';
    }

    var hidden = $("[name=product]", formRef());
    if (hidden) hidden.value = p.title + " (" + p.dims + ")";
    var related = $("[data-p-related]");
    if (related) {
      var rel = TK.products.filter(function (x) { return x.id !== p.id && x.category === p.category; });
      if (rel.length < 3) rel = rel.concat(TK.products.filter(function (x) { return x.id !== p.id; })).slice(0, 3);
      related.innerHTML = rel.slice(0, 3).map(productCard).join("");
    }
  }

  function formRef() { return document; }

  /* ---------- Примеры работ ---------- */
  function initExamples() {
    var box = $("[data-examples]");
    if (!box) return;
    var src = (TK.products[0].images || []).concat([
      { src: "img/hozhblok.svg", cap: "Хозблок 3×2 м на объекте" },
      { src: "img/tualet.svg", cap: "Туалет с выгребной ямой" },
      { src: "img/kacheli.svg", cap: "Качели садовые" }
    ]);
    box.innerHTML = src.map(function (im) {
      return '<img src="' + im.src + '" alt="' + im.cap + '" loading="lazy" width="400" height="300" data-cap="' + im.cap + '">';
    }).join("");
    box.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("img") : null;
      if (!t) return;
      var i = $$("img", box).indexOf(t);
      Lightbox.open(src, i);
    });
  }

  /* ---------- Подстановка данных компании ---------- */
  function initCompany() {
    if (!TK.company) return;
    $$("[data-co=phone]").forEach(function (el) { el.textContent = TK.company.phone; });
    $$("[data-co=phone]").forEach(function (el) { if (el.tagName === "A") el.href = TK.company.phoneHref; });
    $$("[data-co=tg]").forEach(function (el) { el.textContent = TK.company.telegram; el.href = "https://t.me/" + TK.company.telegram.replace(/^@/, ""); });
    $$("[data-co=email]").forEach(function (el) { el.textContent = TK.company.email; el.href = "mailto:" + TK.company.email; });
    $$("[data-co=address]").forEach(function (el) { el.textContent = TK.company.address; });
    $$("[data-co=hours]").forEach(function (el) { el.textContent = TK.company.hours; });
    $$("[data-co=years]").forEach(function (el) { el.textContent = TK.company.years; });
    $$("[data-co=objects]").forEach(function (el) { el.textContent = TK.company.objects; });
    $$("[data-co=warranty]").forEach(function (el) { el.textContent = TK.company.warranty; });
    $$("[data-co=region]").forEach(function (el) { el.textContent = TK.company.region; });
  }

  /* ---------- Рендер страниц «Доставка и монтаж» и «О компании» из данных ---------- */
  function initInfoPages() {
    var D = TK.delivery, A = TK.about, box;

    if (D && (box = $("[data-delivery-zones]"))) {
      box.innerHTML = "<tbody>" + D.zones.map(function (z) {
        return "<tr><th>" + z.title + "</th><td>" + z.price + "</td><td>" + z.term + "</td></tr>";
      }).join("") + "</tbody>";
    }
    if (D && (box = $("[data-delivery-terms]"))) {
      box.innerHTML = D.terms.map(function (t) { return "<li>" + t + "</li>"; }).join("");
    }
    if (D && (box = $("[data-delivery-stages]"))) {
      box.innerHTML = D.stages.map(function (s) {
        return '<div class="step"><h3>' + s.title + '</h3><p>' + s.text + '</p></div>';
      }).join("");
    }
    if (A && (box = $("[data-about-facts]"))) {
      box.innerHTML = A.facts.map(function (f) {
        return '<div class="feature"><div class="feature__num">' + f.n + '</div><h3>' + f.t + '</h3><p>' + f.d + '</p></div>';
      }).join("");
    }
    if (A && (box = $("[data-about-principles]"))) {
      box.innerHTML = A.principle.map(function (p) {
        return '<div class="feature"><h3>' + p.t + '</h3><p>' + p.d + '</p></div>';
      }).join("");
    }
    if (A && (box = $("[data-about-equipment]"))) {
      box.innerHTML = A.equipment.map(function (e) { return "<li>" + e + "</li>"; }).join("");
    }
    if (A && (box = $("[data-about-timeline]"))) {
      box.innerHTML = A.timeline.map(function (t) {
        return '<li><b>' + t.y + '</b><span><strong>' + t.t + "</strong><br>" + t.d + "</span></li>";
      }).join("");
    }
    if (TK.faq && (box = $("[data-faq]"))) {
      box.innerHTML = TK.faq.map(function (f, i) {
        return '<details class="faq"' + (i === 0 ? " open" : "") + "><summary>" + f.q + "</summary><p>" + f.a + "</p></details>";
      }).join("");
    }
  }

  /* ---------- Сводка расчёта, если калькулятора на странице нет ---------- */
  function initSummaryOnly() {
    var summary = $("[data-calc-summary]");
    if (!summary || $("[data-calc]") || !TK.products || !TK.products[0]) return;
    var p = TK.products[0];
    summary.innerHTML = "Интересует: <b>" + p.title + "</b> — " + p.dims + ", " + p.material.split(",")[0] +
      ". Цена от <b>" + rub(p.price) + "</b>. Уточните размеры в комментарии, посчитаем точнее.";
  }

  /* ---------- Запуск ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    Lightbox.build();
    initMenu();
    initCompany();
    initHomeCards();
    initCatalog();
    initCalc();
    initInfoPages();
    initSummaryOnly();
    initForm();
    initTabs();
    initProductPage();
    initExamples();
    document.documentElement.setAttribute("data-tk-ready", "1");
  });
})();