export type UiLanguage = 'de' | 'en' | 'ru' | 'uk' | 'tr' | 'ar';
export const KNOWN_LANGS: readonly UiLanguage[] = ['de', 'en', 'ru', 'uk', 'tr', 'ar'];
// Additional first-run languages require native review; Arabic requires [name].
export const REVIEWED_LANGS: readonly UiLanguage[] = ['de', 'en'];
export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (KNOWN_LANGS as readonly string[]).includes(value);
}
export function renderLang(preference: UiLanguage): 'de' | 'en' {
  return preference === 'de' ? 'de' : 'en';
}
export function detectLanguage(languages: readonly string[]): 'de' | 'en' {
  return languages[0]?.toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}
/** Same resolver for pre-paint and post-hydration attributes. Without a stored choice the browser locale decides: de* German, everything else English (pick-ux-pub-03 A). */
export const LANGUAGE_HEAD_SCRIPT = `(function(){var p;try{p=localStorage.getItem('medpruef-lang');if(!p&&localStorage.getItem('medpruef_session_token')){var s=JSON.parse(localStorage.getItem('medpruef_session')||'null');if(/^(de|en|ru|uk|tr|ar)$/.test(s&&s.user&&s.user.language_code||''))p=s.user.language_code}p=p||localStorage.getItem('medpruef-lang-auto')}catch(e){}if(!p){try{var n=typeof navigator!=='undefined'&&!/bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent||'')&&((navigator.languages&&navigator.languages[0])||navigator.language)||'';if(n)p=n.toLowerCase().split('-')[0]==='de'?'de':'en'}catch(e){}}var r=${JSON.stringify(REVIEWED_LANGS)};var l=p&&r.indexOf(p)>=0?p:/^(en|ru|uk|tr|ar)$/.test(p||'')?'en':'de';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr'})()`;
