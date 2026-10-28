// Presentation-only metadata keyed by lottery id (names in Sinhala/Tamil, accent hue).
// Anything structural (counts, ranges) comes from the API, never from here.

export interface LotteryMeta {
  si: string
  ta: string
  hue: number // accent hue used for the card's jewel tint
}

export const LOTTERY_META: Record<string, LotteryMeta> = {
  'dhana-nidhanaya': { si: 'ධන නිධානය', ta: 'தன நிதானய', hue: 42 },
  'mega-power': { si: 'මෙගා පවර්', ta: 'மெகா பவர்', hue: 352 },
  govisetha: { si: 'ගොවි සෙත', ta: 'கொவி செத', hue: 142 },
  'ada-kotipathi': { si: 'අද කෝටිපති', ta: 'அද கோடிபதி', hue: 265 },
  'super-ball': { si: 'සුපර් බෝල්', ta: 'சூப்பர் பால்', hue: 205 },
  shanida: { si: 'සනිදා', ta: 'சனிதா', hue: 18 },
  kapruka: { si: 'කප්රුක', ta: 'கப்ருக', hue: 172 },
}

export const LOTTERY_ORDER = [
  'dhana-nidhanaya',
  'mega-power',
  'govisetha',
  'ada-kotipathi',
  'super-ball',
  'shanida',
  'kapruka',
]

export function metaFor(id: string): LotteryMeta {
  return LOTTERY_META[id] ?? { si: '', ta: '', hue: 42 }
}

export const ZODIAC = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
]

export const ZODIAC_GLYPH: Record<string, string> = {
  Aries: '♈',
  Taurus: '♉',
  Gemini: '♊',
  Cancer: '♋',
  Leo: '♌',
  Virgo: '♍',
  Libra: '♎',
  Scorpio: '♏',
  Sagittarius: '♐',
  Capricorn: '♑',
  Aquarius: '♒',
  Pisces: '♓',
}
