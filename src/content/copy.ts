// Тексты. HE — основной язык витрины, RU — для ревью и русскоязычных гостей.
// Тон: короткие утвердительные фразы, факты вместо прилагательных.

export type Locale = 'he' | 'ru' | 'en'

export const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  he: {
    espresso: 'אספרסו', filter: 'פילטר', cold: 'קר', nocoffee: 'לא קפה',
    food: 'אוכל', sweet: 'מתוק', beans: 'שק הביתה',
  },
  ru: {
    espresso: 'Эспрессо', filter: 'Фильтр', cold: 'Холодное', nocoffee: 'Не кофе',
    food: 'Еда', sweet: 'Сладкое', beans: 'Зерно домой',
  },
  en: {
    espresso: 'Espresso', filter: 'Filter', cold: 'Cold', nocoffee: 'Not coffee',
    food: 'Food', sweet: 'Sweet', beans: 'Beans to go',
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
  touchHint: string
  actTwoTitle: string
  actTwoText: string
  actThreeTitle: string
  actThreeText: string
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
    cursorHint: 'העבירו את העכבר על הכוס — היא מגיבה',
    touchHint: 'הקישו על הכוס',
    actTwoTitle: 'מה שכתוב על הכוס',
    actTwoText:
      'קולים כאן, בכל יום שלישי, על רוסטר של 5 ק״ג. בלי סירופים, בלי גדלים, שני סוגי חלב. ' +
      'מי שבא עם כוס משלו משלם 2 ₪ פחות.',
    actThreeTitle: 'ואז מוזגים',
    actThreeText: 'אספרסו בנפח הנכון, בלי לשאול על סוכר. הסוכר על הבר.',
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
    cursorHint: 'наведите на чашку — она отзовётся',
    touchHint: 'коснитесь чашки',
    actTwoTitle: 'Что написано на чашке',
    actTwoText:
      'Жарим здесь, каждый вторник, на ростере 5 кг. Без сиропов, без размеров, два вида молока. ' +
      'Пришёл со своей кружкой — минус 2 ₪.',
    actThreeTitle: 'А потом наливаем',
    actThreeText: 'Эспрессо в правильном объёме. Про сахар не спрашиваем — он на стойке.',
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
  en: {
    dir: 'ltr',
    brand: 'Shachor',
    heroLine: 'Coffee, nothing extra',
    heroFact: 'Jaffa · roasted here on Tuesdays',
    heroHint: 'scroll',
    ctaMenu: 'Menu',
    ctaBook: 'Book a table',
    cursorHint: 'point at the cup — it answers',
    touchHint: 'tap the cup',
    actTwoTitle: 'What the cup says',
    actTwoText:
      'We roast here every Tuesday on a 5 kg roaster. No syrups, no sizes, two kinds of milk. ' +
      'Bring your own cup and pay 2 ₪ less.',
    actThreeTitle: 'Then we pour',
    actThreeText: 'Espresso in the right volume. We never ask about sugar — it lives on the bar.',
    ticker: [
      'This week: Ethiopia · Guji · natural',
      'Roasting every Tuesday',
      'Your own cup — 2 ₪ off',
      'Shakshuka on Fridays',
      'Sun–Thu 07:00–19:00 · Fri until 15:00',
    ],
    beanTitle: 'Bean of the week',
    beanRoasted: 'roasted',
    menuTitle: 'The menu is short on purpose',
    menuNote: 'Two kinds of milk, no syrups, no sizes. Sugar is on the bar.',
    menuAll: 'Full menu',
    spaceTitle: 'The room',
    spaceText:
      'One vaulted room, one window facing east, and a long table everyone shares. ' +
      'The roaster stands behind the bar — what you drink here was roasted here.',
    spaceFacts: ['1920s building', 'Shared table for 12', '5 kg roaster', 'Courtyard, 4 tables'],
    loyaltyTitle: 'Five coffees — the sixth is on us',
    loyaltyText: 'Brought your own cup? 2 ₪ off. No stickers, no app.',
    bookTitle: 'Book a table',
    bookRule: 'Only courtyard tables are bookable. The long table and the bar are first come, first served.',
    bookHold: 'We hold a table for 15 minutes.',
    bookCta: 'Message us on WhatsApp',
    visitTitle: 'Hours and address',
    visitAddress: '6 HaBurskai Lane, Jaffa',
    visitPhone: '03-000-0000',
    hoursRows: [
      ['Sunday–Thursday', '07:00–19:00'],
      ['Friday', '07:00–15:00'],
      ['Saturday', 'closed'],
    ],
    kosherOn: 'The kitchen is not kosher',
    footerDemo: 'Demo concept. The address, phone number and images are not real.',
    footerBy: 'Built by Tomer Iukhvidov',
    tweaks: 'Tweaks',
    pause: 'Pause motion',
    play: 'Resume motion',
  },
}
