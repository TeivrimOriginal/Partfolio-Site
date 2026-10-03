/* =========================================================
   Все данные сайта — в одном файле.
   Заказчик меняет цены и позиции здесь, без программиста.
   Правьте только этот файл: index.html, catalog.html и product.html
   подхватывают изменения автоматически.
   ========================================================= */

window.TK = {
  company: {
    name: "Тёплый Контур",
    tagline: "Деревянные бытовки, хозблоки и туалеты под ключ",
    phone: "+7 (495) 000-00-00",
    phoneHref: "tel:+74950000000",
    email: "zakaz@example.ru",
    telegram: "@teply_kontur",
    address: "141250, Московская область, г. Дмитров, ул. Производственная, 14",
    hours: "Пн–Сб, 8:00–20:00",
    years: 12,
    objects: 840,
    warranty: 3,
    region: "Москва и область — бесплатно, до 800 км — по тарифу, дальше ТК/фура"
  },

  categories: [
    { id: "bytovka",  title: "Бытовки",           img: "img/cat-bytovka.svg",   note: "Для жилья и офиса" },
    { id: "bytovka2", title: "Бытовки эконом",    img: "img/cat-bystrovka-2.svg", note: "Без утепления, для сезона" },
    { id: "hozhblok", title: "Хозяйственные блоки", img: "img/cat-hozhblok.svg",  note: "Инвентарь, техника" },
    { id: "tualet",   title: "Туалеты",           img: "img/cat-tualet.svg",    note: "С выгребной ямой или под септик" },
    { id: "kacheli",  title: "Качели",            img: "img/cat-kacheli.svg",   note: "Садовые, с навесом" }
  ],

  products: [
    {
      id: "bytovka-6x3",
      slug: "bytovka-6x3",
      title: "Бытовка 6×3 м, утеплённая",
      category: "bytovka",
      price: 78900,
      oldPrice: 84500,
      badges: ["hit"],
      popularity: 98,
      added: "2026-02-14",
      dims: "6 × 3 × 2,7 м",
      area: "18 м²",
      weight: "2 400 кг",
      material: "Каркас из сухой сосны 50×100, обшивка имитацией бруса",
      insulation: "100 мм (минвата), пол и крыша — 100 мм",
      roof: "Профнастил С8 по обрешётке, уклон 15°",
      floor: "Шпунтованная доска 28 мм, лаги 50×150",
      windows: "2 окна ПВХ, двухкамерный стеклопакет",
      doors: "Дверь утеплённая, 870 мм",
      kit: "Каркас, обшивка, утеплитель, пол, потолок, окна ПВХ, дверь, электрика (точка розетки и светильник), винтовой фундамент",
      terms: "7–10 рабочих дней",
      delivery: "Доставка своим транспортом + монтаж на шнеки за 1 день",
      images: [
        { src: "img/bytovka-front.svg", cap: "Бытовка 6×3 м, вид с фасада" },
        { src: "img/bytovka-side.svg",  cap: "Вид с торца, длина 6 м" },
        { src: "img/bytovka-inside.svg", cap: "Внутренний вид: утеплитель 100 мм" },
        { src: "img/bytovka-frame.svg",  cap: "Каркас до обшивки: стойки 50×100" }
      ],
      files: [{ name: "КП: бытовка 6×3 м, комплектация и цена", href: "kp/bytovka-6x3-kp.html" }]
    },
    {
      id: "bytovka-4x2",
      slug: "bytovka-4x2",
      title: "Бытовка 4×2 м, эконом",
      category: "bytovka2",
      price: 54000,
      badges: [],
      popularity: 74,
      added: "2026-04-02",
      dims: "4 × 2 × 2,5 м",
      area: "8 м²",
      weight: "1 100 кг",
      material: "Каркас из ели 50×100, обшивка вагонкой",
      insulation: "Без утепления (сезонное исполнение)",
      roof: "Профнастил С8",
      floor: "Доска 25 мм",
      windows: "1 окно ПВХ",
      doors: "Дверь деревянная, 800 мм",
      kit: "Каркас, обшивка, пол, дверь, одно окно",
      terms: "5–7 рабочих дней",
      delivery: "Доставка нашим транспортом, монтаж по запросу",
      images: [
        { src: "img/bytovka-front.svg", cap: "Бытовка 4×2 м, эконом" },
        { src: "img/bytovka-inside.svg", cap: "Внутренний вид" },
        { src: "img/bytovka-frame.svg",  cap: "Каркас 50×100" },
        { src: "img/hozhblok.svg",       cap: "Хозблок в комплекте" }
      ],
      files: []
    },
    {
      id: "bytovka-7x3-2",
      slug: "bytovka-7x3-2",
      title: "Бытовка 7×3 м, двухкомнатная",
      category: "bytovka",
      price: 112000,
      badges: ["new"],
      popularity: 61,
      added: "2026-09-08",
      dims: "7 × 3 × 2,8 м",
      area: "21 м²",
      weight: "3 100 кг",
      material: "Каркас из лиственницы 50×150, обшивка имитацией бруса",
      insulation: "150 мм каменная вата по всему контуру",
      roof: "Металлочерепица, уклон 20°",
      floor: "Шпунтованная доска 28 мм, утеплённый пол",
      windows: "3 окна ПВХ + одна внутренняя дверь",
      doors: "Входная дверь утеплённая, 870 мм",
      kit: "Полный комплект, перегородка между комнатами, электрика с автоматами, шнековый фундамент",
      terms: "14–18 рабочих дней",
      delivery: "Доставка + монтаж, подъём краном при необходимости",
      images: [
        { src: "img/bytovka-front.svg", cap: "Бытовка 7×3 м, двухкомнатная" },
        { src: "img/bytovka-side.svg",  cap: "Длина корпуса 7 м" },
        { src: "img/bytovka-inside.svg", cap: "Утепление 150 мм" },
        { src: "img/bytovka-frame.svg",  cap: "Каркас из лиственницы" }
      ],
      files: []
    },
    {
      id: "hozhblok-3x2",
      slug: "hozhblok-3x2",
      title: "Хозблок 3×2 м, утеплённый",
      category: "hozhblok",
      price: 41000,
      badges: [],
      popularity: 55,
      added: "2026-05-19",
      dims: "3 × 2 × 2,3 м",
      area: "6 м²",
      weight: "850 кг",
      material: "Каркас из сосны 50×100, обшивка профнастилом",
      insulation: "50 мм (пенополистирол)",
      roof: "Профнастил С8",
      floor: "Доска 28 мм на лагах",
      windows: "1 окно ПВХ",
      doors: "Дверь с замком",
      kit: "Каркас, обшивка, утеплитель, пол, дверь, окно",
      terms: "5–7 рабочих дней",
      delivery: "Доставка в день заказа по области",
      images: [
        { src: "img/hozhblok.svg",      cap: "Хозблок 3×2 м" },
        { src: "img/bytovka-inside.svg", cap: "Внутри: пол и стойки" },
        { src: "img/bytovka-frame.svg",  cap: "Каркас" },
        { src: "img/bytovka-side.svg",   cap: "Торец" }
      ],
      files: []
    },
    {
      id: "tualet-12",
      slug: "tualet-12",
      title: "Туалет 1,2×1,2 м, с ямой",
      category: "tualet",
      price: 22500,
      badges: [],
      popularity: 42,
      added: "2026-06-11",
      dims: "1,2 × 1,2 × 2,2 м",
      area: "1,4 м²",
      weight: "240 кг",
      material: "Каркас из сосны, обшивка вагонкой",
      insulation: "Без утепления",
      roof: "Профнастил, вентиляционная труба",
      floor: "Доска, яма 0,8×0,8×1 м в комплекте",
      windows: "Без окна",
      doors: "Дверь с запором",
      kit: "Каркас, обшивка, дверь, яма, труба, унитаз и бачок",
      terms: "3–5 рабочих дней",
      delivery: "Доставка + установка на грунте",
      images: [
        { src: "img/tualet.svg",        cap: "Туалет 1,2×1,2 м" },
        { src: "img/bytovka-frame.svg", cap: "Каркас туалета" },
        { src: "img/hozhblok.svg",       cap: "Вариант 1,6×1,6 м" },
        { src: "img/bytovka-inside.svg", cap: "Внутренняя отделка" }
      ],
      files: []
    },
    {
      id: "kacheli-2",
      slug: "kacheli-2",
      title: "Качели садовые 2 м, с навесом",
      category: "kacheli",
      price: 16800,
      oldPrice: 18500,
      badges: ["hit"],
      popularity: 88,
      added: "2026-03-27",
      dims: "2 × 1,1 × 2,1 м",
      area: "—",
      weight: "95 кг",
      material: "Сосна, брус 70×70, сиденье — лиственница",
      insulation: "Навес из поликарбоната 6 мм",
      roof: "Поликарбонат",
      floor: "—",
      windows: "—",
      doors: "—",
      kit: "Стойки, сиденье, цепи, навес, крепёж, инструкция",
      terms: "2–3 рабочих дня",
      delivery: "Доставка, сборка за 2 часа",
      images: [
        { src: "img/kacheli.svg",        cap: "Качели 2 м с навесом" },
        { src: "img/kacheli.svg",        cap: "Каркас, фото 2" },
        { src: "img/hozhblok.svg",       cap: "Дерево в наличии" },
        { src: "img/bytovka-frame.svg",  cap: "Крепёж и узлы" }
      ],
      files: []
    }
  ],

  /* Параметры калькулятора: меняются здесь же.
     Модель цены: стоимость за м² + базовая надбавка (фундамент, обвязка, крепёж),
     далее опции считаются фиксированными суммами за изделие. */
  calc: {
    minArea: 4,
    area: [
      { v: "bytovka",  label: "Бытовка утеплённая", perM2: 2900, add: 26000 },
      { v: "bytovka2", label: "Бытовка эконом",     perM2: 2500, add: 34000 },
      { v: "hozhblok", label: "Хозблок",            perM2: 2400, add: 26600 },
      { v: "tualet",   label: "Туалет",             perM2: 4000, add: 16900 },
      { v: "kacheli",  label: "Качели садовые",     fixed: 16800 }
    ],
    insulation: [
      { v: "none", label: "Без утепления",      add: -18000 },
      { v: "w50",  label: "50 мм",              add: -9000 },
      { v: "w100", label: "100 мм (в базе)",    add: 0 },
      { v: "w150", label: "150 мм",             add: 9000 },
      { v: "w200", label: "200 мм",             add: 16200 }
    ],
    roof: [
      { v: "prof",  label: "Профнастил (в базе)", add: 0 },
      { v: "soft",  label: "Мягкая кровля",       add: 16200 },
      { v: "metal", label: "Металлочерепица",     add: 21600 }
    ],
    windows: [
      { v: 0, label: "Без окон",            add: -11000 },
      { v: 1, label: "1 окно",              add: -5500 },
      { v: 2, label: "2 окна (в базе)",     add: 0 },
      { v: 3, label: "3 окна",              add: 7500 }
    ],
    doors: [
      { v: 0, label: "Без двери",           add: -5500 },
      { v: 1, label: "1 дверь (в базе)",    add: 0 },
      { v: 2, label: "2 двери",             add: 5500 }
    ],
    deliveryPerKm: 12,
    montage: 18000,
    discount: 0.9 /* 10% при заказе от 100 000 ₽ */
  },

  faq: [
    { q: "Можно ли зимой?", a: "Да. Каркас собираем круглый год, монтаж на снежный шнек или винтовые сваи — по согласованию." },
    { q: "Что с фундаментом?", a: "Винтовые сваи под всю площадь пола, до 300 мм грунта. Входит в базовую цену изделия." },
    { q: "Сколько ждать монтаж?", a: "Доставка в день заказа, сборка — 1 рабочий день, бригада из 2 человек." },
    { q: "Какая гарантия?", a: "3 года на каркас и кровлю, 2 года на утеплитель и фурнитуру. Сервисное обслуживание — от 4 000 ₽ в год." }
  ]
};

/* Метрики: сколько «посмотрели» карточку — имитация, для демонстрации сортировки */
window.TK.metrics = { views: { "bytovka-6x3": 1248, "bytovka-4x2": 862, "bytovka-7x3-2": 604, "hozhblok-3x2": 431, "tualet-12": 288, "kacheli-2": 1013 } };