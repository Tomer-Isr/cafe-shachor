// Тексты. HE — основной язык витрины, RU — для ревью и русскоязычных гостей.
// Тон: короткие утвердительные фразы, факты вместо прилагательных.

export type Locale = 'he' | 'ru'

export const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  he: {
    espresso: 'אספרסו', filter: 'פילטר', cold: 'קר', nocoffee: 'לא קפה',
    food: 'אוכל', sweet: 'מתוק', beans: 'שק הביתה',
  },
  ru: {
    espresso: 'Эспрессо', filter: 'Фильтр', cold: 'Холодное', nocoffee: 'Не кофе',
    food: 'Еда', sweet: 'Сладкое', beans: 'Зерно домой',
  },
}

export interface Copy {
  dir: 'rtl' | 'ltr'
  brand: string
  heroLine: string
  heroFact: string
  heroHint: string
  ctaMenu: string
  ctaBook: string
  cursorHint: string
  ticker: readonly string[]
  beanTitle: string
  beanRoasted: string
  menuTitle: string
  menuNote: string
  menuAll: string
  spaceTitle: string
  spaceText: string
  spaceFacts: readonly string[]
  loyaltyTitle: string
  loyaltyText: string
  bookTitle: string
  bookRule: string
  bookHold: string
  bookCta: string
  visitTitle: string
  visitAddress: string
  visitPhone: string
  hoursRows: readonly (readonly [string, string])[]
  kosherOn: string
  footerDemo: string
  footerBy: string
  tweaks: string
  pause: string
  play: string
}

export const COPY: Record<Locale, Copy> = {
  he: {
    dir: 'rtl',
    brand: 'שחור',
    heroLine: 'קפה בלי מיותר',
    heroFact: 'יפו · נקלה כאן ביום שלישי',
    heroHint: 'גללו',
    ctaMenu: 'לתפריט',
    ctaBook: 'להזמנת שולחן',
    cursorHint: 'הזיזו את העכבר — האדים נסוגים',
    ticker: [
      'פולי השבוע: אתיופיה · גוג׳י · נטורל',
      'קולים כל יום שלישי',
      'כוס משלכם — 2 ₪ פחות',
      'שקשוקה בימי שישי',
      'א׳–ה׳ 07:00–19:00 · ו׳ עד 15:00',
    ],
    beanTitle: 'פולי השבוע',
    beanRoasted: 'נקלה',
    menuTitle: 'תפריט קצר בכוונה',
    menuNote: 'שני סוגי חלב, בלי סירופים, בלי גדלים. סוכר על הבר.',
    menuAll: 'כל התפריט',
    spaceTitle: 'המקום',
    spaceText:
      'אולם אחד עם תקרת קשתות, חלון אחד למזרח, ושולחן ארוך שכולם חולקים. ' +
      'הרוסטר עומד מאחורי הבר — מה ששותים פה, נקלה פה.',
    spaceFacts: ['בניין משנות ה־20', 'שולחן משותף ל־12', 'רוסטר 5 ק״ג', 'חצר עם 4 שולחנות'],
    loyaltyTitle: 'חמישה קפה — השישי עלינו',
    loyaltyText: 'באים עם כוס משלכם? 2 ₪ פחות. בלי מדבקות, בלי אפליקציה.',
    bookTitle: 'הזמנת שולחן',
    bookRule: 'מזמינים רק שולחנות בחצר. השולחן הארוך והבר — מי שהגיע, יושב.',
    bookHold: 'שומרים שולחן 15 דקות.',
    bookCta: 'לתאם בוואטסאפ',
    visitTitle: 'שעות וכתובת',
    visitAddress: 'סמטת הבורסקי 6, יפו',
    visitPhone: '03-000-0000',
    hoursRows: [
      ['ראשון–חמישי', '07:00–19:00'],
      ['שישי', '07:00–15:00'],
      ['שבת', 'סגור'],
    ],
    kosherOn: 'המטבח אינו כשר',
    footerDemo: 'קונספט הדגמה. הכתובת, הטלפון והתמונות אינם אמיתיים.',
    footerBy: 'נבנה על ידי Tomer Iukhvidov',
    tweaks: 'כוונון',
    pause: 'עצירת תנועה',
    play: 'הפעלת תנועה',
  },
  ru: {
    dir: 'ltr',
    brand: 'Shachor',
    heroLine: 'Кофе без лишнего',
    heroFact: 'Яффо · жарим здесь по вторникам',
    heroHint: 'листайте',
    ctaMenu: 'Меню',
    ctaBook: 'Забронировать стол',
    cursorHint: 'Проведите курсором — пар расступается',
    ticker: [
      'Зерно недели: Эфиопия · Гуджи · натуральная',
      'Жарим по вторникам',
      'Своя кружка — минус 2 ₪',
      'Шакшука по пятницам',
      'Вс–чт 07:00–19:00 · пт до 15:00',
    ],
    beanTitle: 'Зерно недели',
    beanRoasted: 'обжарено',
    menuTitle: 'Меню короткое намеренно',
    menuNote: 'Два вида молока, без сиропов, без размеров. Сахар на стойке.',
    menuAll: 'Всё меню',
    spaceTitle: 'Место',
    spaceText:
      'Один зал со сводчатым потолком, одно окно на восток и длинный стол, который делят все. ' +
      'Ростер стоит за стойкой — что здесь пьют, здесь и обжарено.',
    spaceFacts: ['Дом 1920-х', 'Общий стол на 12', 'Ростер 5 кг', 'Дворик на 4 стола'],
    loyaltyTitle: 'Пять кофе — шестой за наш счёт',
    loyaltyText: 'Пришли со своей кружкой? Минус 2 ₪. Без наклеек и приложений.',
    bookTitle: 'Бронь стола',
    bookRule: 'Бронируем только столы во дворике. Общий стол и бар — кто пришёл, тот сидит.',
    bookHold: 'Держим стол 15 минут.',
    bookCta: 'Написать в WhatsApp',
    visitTitle: 'Часы и адрес',
    visitAddress: 'Переулок ха-Бурскаи 6, Яффо',
    visitPhone: '03-000-0000',
    hoursRows: [
      ['Воскресенье–четверг', '07:00–19:00'],
      ['Пятница', '07:00–15:00'],
      ['Суббота', 'закрыто'],
    ],
    kosherOn: 'Кухня не кошерная',
    footerDemo: 'Демо-концепт. Адрес, телефон и изображения не настоящие.',
    footerBy: 'Собрано Tomer Iukhvidov',
    tweaks: 'Настройки',
    pause: 'Остановить движение',
    play: 'Включить движение',
  },
}
