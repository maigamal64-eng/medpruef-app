/**
 * LX-12 install-guide drafts for ru, uk and tr: NOT ACTIVE.
 *
 * These languages render the reviewed English copy (REVIEWED_LANGS = de, en)
 * until a native reviewer signs them off (a10 language model). Nothing imports
 * this file at runtime; it exists so the reviewer edits real strings, not a
 * spreadsheet. Arabic is left empty on purpose (pick-arabic A: English
 * fallback until [name] signs off). Keys mirror PwaCopy in master-pwa/copy.ts.
 */

export const LX12_DRAFT_STATUS = 'draft: needs native review' as const;

export const LX12_DRAFTS = {
  ru: {
    installTitle: 'MedPrüf на экране «Домой»',
    installIntro: 'Как добавить MedPrüf на iPhone или iPad как приложение:',
    steps: {
      'open-share': 'Нажмите на значок «Поделиться» (квадрат со стрелкой вверх).',
      'add-to-home': 'Выберите «На экран „Домой“». Если пункта нет, откройте страницу в Safari.',
      confirm: 'Нажмите «Добавить» вверху справа.',
      'open-from-home': 'Открывайте MedPrüf через новый значок на экране «Домой».',
    },
    inAppTitle: 'Откройте в Safari',
    inAppBody: 'Браузер внутри другого приложения не может установить MedPrüf. Откройте эту страницу в Safari и следуйте инструкции.',
    copyLink: 'Скопировать ссылку',
  },
  uk: {
    installTitle: 'MedPrüf на початковому екрані',
    installIntro: 'Як додати MedPrüf на iPhone або iPad як застосунок:',
    steps: {
      'open-share': 'Натисніть значок «Поширити» (квадрат зі стрілкою вгору).',
      'add-to-home': 'Виберіть «На початковий екран». Якщо пункту немає, відкрийте сторінку в Safari.',
      confirm: 'Натисніть «Додати» вгорі праворуч.',
      'open-from-home': 'Відкривайте MedPrüf через новий значок на початковому екрані.',
    },
    inAppTitle: 'Відкрийте в Safari',
    inAppBody: 'Браузер усередині іншого застосунку не може встановити MedPrüf. Відкрийте цю сторінку в Safari та виконайте інструкцію.',
    copyLink: 'Скопіювати посилання',
  },
  tr: {
    installTitle: 'Ana Ekranda MedPrüf',
    installIntro: 'MedPrüf’ü iPhone veya iPad’inize uygulama olarak eklemek için:',
    steps: {
      'open-share': 'Paylaş simgesine dokunun (yukarı oklu kare).',
      'add-to-home': '“Ana Ekrana Ekle”yi seçin. Seçenek yoksa sayfayı Safari’de açın.',
      confirm: 'Sağ üstte “Ekle”ye dokunun.',
      'open-from-home': 'MedPrüf’ü bundan sonra Ana Ekrandaki yeni simgeden açın.',
    },
    inAppTitle: 'Lütfen Safari’de açın',
    inAppBody: 'Başka bir uygulamanın içindeki tarayıcı MedPrüf’ü yükleyemez. Bu sayfayı Safari’de açın ve adımları izleyin.',
    copyLink: 'Bağlantıyı kopyala',
  },
  ar: null,
} as const;
