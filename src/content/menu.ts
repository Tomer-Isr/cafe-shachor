// Единственный источник структуры меню. Цены — ₪, целые.
// Правка цены здесь меняет её на витрине, в тизере и в JSON-LD.

export const CATEGORIES = ['espresso', 'filter', 'cold', 'nocoffee', 'food', 'sweet', 'beans'] as const
export type CategoryId = (typeof CATEGORIES)[number]

export type Diet = 'vegan' | 'gf' | 'spicy'

export interface MenuItem {
  id: string
  category: CategoryId
  price: number
  he: string
  ru: string
  diet?: Diet[]
  /** только по пятницам (кухня) */
  friday?: boolean
  /** готовится на зерне недели */
  bean?: boolean
  /** попадает в тизер на главной */
  signature?: boolean
}

export const MENU: readonly MenuItem[] = [
  { id: 'espresso', category: 'espresso', price: 12, he: 'אספרסו', ru: 'Эспрессо' },
  { id: 'doppio', category: 'espresso', price: 14, he: 'אספרסו כפול', ru: 'Двойной эспрессо' },
  { id: 'macchiato', category: 'espresso', price: 13, he: 'מקיאטו', ru: 'Макиато' },
  { id: 'cortado', category: 'espresso', price: 14, he: 'קורטדו', ru: 'Кортадо', signature: true },
  { id: 'flatwhite', category: 'espresso', price: 16, he: 'פלאט וויט', ru: 'Флэт уайт' },
  { id: 'cappuccino', category: 'espresso', price: 15, he: 'קפה הפוך', ru: 'Капучино' },
  { id: 'latte', category: 'espresso', price: 16, he: 'לאטה', ru: 'Латте' },
  { id: 'botz', category: 'espresso', price: 12, he: 'קפה שחור (בוץ)', ru: 'Чёрный по-турецки', signature: true },

  { id: 'v60', category: 'filter', price: 20, he: 'פילטר V60', ru: 'Фильтр V60', bean: true, signature: true },
  { id: 'aeropress', category: 'filter', price: 20, he: 'אירופרס', ru: 'Аэропресс', bean: true },
  { id: 'batch', category: 'filter', price: 14, he: 'באטש ברו', ru: 'Батч-брю' },
  { id: 'coldbrew', category: 'filter', price: 19, he: 'קולד ברו', ru: 'Колд-брю', diet: ['vegan'], signature: true },

  { id: 'iced_americano', category: 'cold', price: 15, he: 'אייס אמריקנו', ru: 'Айс-американо', diet: ['vegan'] },
  { id: 'iced_latte', category: 'cold', price: 17, he: 'אייס לאטה', ru: 'Айс-латте' },
  { id: 'shakerato', category: 'cold', price: 18, he: 'שייקרטו', ru: 'Шейкерато' },
  { id: 'tonic', category: 'cold', price: 21, he: 'אספרסו טוניק', ru: 'Эспрессо-тоник', diet: ['vegan'], signature: true },

  { id: 'matcha', category: 'nocoffee', price: 24, he: 'מאצ׳ה לאטה', ru: 'Матча-латте' },
  { id: 'herbal', category: 'nocoffee', price: 14, he: 'חליטת צמחים', ru: 'Травяной чай', diet: ['vegan'] },
  { id: 'choco', category: 'nocoffee', price: 17, he: 'שוקו חם', ru: 'Горячий шоколад' },

  { id: 'croissant', category: 'food', price: 16, he: 'קרואסון חמאה', ru: 'Круассан на масле' },
  { id: 'burekas', category: 'food', price: 16, he: 'בורקס גבינה', ru: 'Бурекас с сыром' },
  { id: 'avocado', category: 'food', price: 38, he: 'טוסט אבוקדו', ru: 'Тост с авокадо', diet: ['vegan'] },
  { id: 'shakshuka', category: 'food', price: 42, he: 'שקשוקה', ru: 'Шакшука', diet: ['spicy'], friday: true },
  { id: 'salad', category: 'food', price: 39, he: 'סלט בוקר', ru: 'Утренний салат', diet: ['vegan', 'gf'] },

  { id: 'tahini_cookie', category: 'sweet', price: 9, he: 'עוגיית טחינה', ru: 'Печенье тахини', diet: ['vegan', 'gf'] },
  { id: 'choco_tart', category: 'sweet', price: 28, he: 'עוגת שוקולד', ru: 'Шоколадный тарт' },
  { id: 'cheesecake', category: 'sweet', price: 30, he: 'צ׳יזקייק יפואי', ru: 'Чизкейк по-яффски', signature: true },

  { id: 'bag250', category: 'beans', price: 72, he: 'שק 250 גרם', ru: 'Пачка 250 г', bean: true },
  { id: 'subscription', category: 'beans', price: 130, he: 'מנוי חודשי · 2 שקים', ru: 'Подписка · 2 пачки/мес' },
] as const

/** Зерно недели — одно место правки, кормит карточки V60/аэропресса и плашку */
export const BEAN_OF_WEEK = {
  he: { origin: 'אתיופיה · גוג׳י', process: 'נטורל', notes: 'אוכמניות ושוקולד' },
  ru: { origin: 'Эфиопия · Гуджи', process: 'натуральная', notes: 'черника и шоколад' },
  /** ISO-дата обжарки; старше 21 дня — дату не показываем (защита от протухшего демо) */
  roastedOn: '2026-08-04',
}

export function beanIsFresh(today = new Date()): boolean {
  const days = (today.getTime() - new Date(BEAN_OF_WEEK.roastedOn).getTime()) / 86_400_000
  return days >= 0 && days <= 21
}
