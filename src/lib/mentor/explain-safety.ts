/** Explain background is conceptual only: never quantities or medication dosing. */
export function unsafeExplainBackground(text: string): boolean {
 if (/\p{N}/u.test(text)) return true;
 const words = /(?<!\p{L})(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|once|twice|eins|eine|einen|einem|einer|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одна|одне|один|два|дві|три|чотири|п'ять|шість|сім|вісім|дев'ять|десять|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|واحد|اتنين|اثنين|تلاتة|ثلاثة)(?!\p{L})/iu;
 // Articles "eine" and "bir" overlap number words: omit them unless next to a unit.
 // The general scanner deliberately stays conservative for unambiguous numerals.
 const unambiguous = words.source.replace("|eine|einen|einem|einer", "").replace("|bir", "");
 if (new RegExp(unambiguous,"iu").test(text)) return true;
 return /(?<!\p{L})(?:mg|mcg|µg|ml|milligram\p{L}*|microgram\p{L}*|dose\p{L}*|dosing|dosierung|dosieren|dosage|doz\p{L}*|доз\p{L}*|جرعة|جرعات)(?!\p{L})/iu.test(text);
}

/** Explicit solution requests reveal the accessible practice key without requiring another hint. */
export function explicitSolutionRequest(message: string): boolean {
 if (/(?:do not|don't|nicht|keine|не показывай|не показуй|gösterme)[^.!?]{0,50}(?:answer|solution|lösung|antwort|ответ|відповідь|cevap|yanıt)/iu.test(message)) return false;
 return /(?:was ist (?:richtig|die richtige antwort)|(?:lösung|antwort) (?:zeigen|bitte)|show (?:me )?(?:the )?(?:answer|solution)|what(?:'s| is) (?:the )?(?:correct|right) answer|(?:покажи|показать) (?:ответ|решение)|какой ответ (?:правильный|верный)|(?:покажи|показати) (?:відповідь|рішення)|яка відповідь правильна|(?:cevabı|yanıtı|çözümü) göster|(?:doğru|dogru) (?:cevap|yanıt) (?:ne|nedir))/iu.test(message);
}
