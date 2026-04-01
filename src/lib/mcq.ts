export interface MCQOption {
  text: string;
  correct: boolean;
}

// Shuffle array in-place using Fisher-Yates
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Create numeric variants: multiply all numbers in the text by a factor
function numericVariant(text: string, factor: number): string {
  return text.replace(/\b(\d+(?:[.,]\d+)?)\b/g, (match) => {
    const n = parseFloat(match.replace(',', '.'));
    if (isNaN(n)) return match;
    const result = Math.round(n * factor * 10) / 10;
    return String(result).replace('.', ',');
  });
}

// Detect if answer is primarily numeric/contains key numbers
function hasSignificantNumbers(text: string): boolean {
  const nums = text.match(/\b\d+(?:[.,]\d+)?\b/g);
  return !!(nums && nums.length > 0 && nums.some((n) => parseFloat(n) > 1));
}

// Topic-specific medical distractor pools (German medical exam terms)
const TOPIC_POOLS: Record<string, string[][]> = {
  'Innere Medizin': [
    ['Metformin', 'Glibenclamid', 'Sitagliptin', 'Empagliflozin', 'Acarbose'],
    ['Herzinsuffizienz', 'Hypertonie', 'Vorhofflimmern', 'KHK', 'Kardiomyopathie'],
    ['Ramipril', 'Bisoprolol', 'Amlodiphin', 'Torasemid', 'Spironolacton'],
    ['Typ-1-Diabetes', 'Typ-2-Diabetes', 'MODY', 'Gestationsdiabetes', 'LADA'],
    ['HbA1c', 'Nüchternblutzucker', 'oGTT', 'C-Peptid', 'Insulinresistenz'],
    ['Pneumonie', 'Pleuritis', 'Lungenembolie', 'COPD', 'Asthma bronchiale'],
    ['Helicobacter pylori', 'Clostridium difficile', 'E. coli', 'Klebsiella', 'Pseudomonas'],
    ['Leberzirrhose', 'Hepatitis B', 'Cholangitis', 'Pankreatitis', 'Cholelithiasis'],
  ],
  'Chirurgische Fächer': [
    ['Appendektomie', 'Cholezystektomie', 'Hernienreparation', 'Hemikolektomie', 'Gastrektomie'],
    ['Appendizitis', 'Cholezystitis', 'Ileus', 'Peritonitis', 'Pankreatitis'],
    ['Resektion', 'Anastomose', 'Drainage', 'Débridement', 'Exzision'],
    ['Laparoskopie', 'Laparotomie', 'Thorakoskopie', 'Arthroskopie', 'Endoskopie'],
    ['Fraktur', 'Luxation', 'Distorsion', 'Ruptur', 'Kontusion'],
    ['Thrombose', 'Embolie', 'Ischämie', 'Gangrän', 'Nekrose'],
  ],
  'Neurologie': [
    ['Schlaganfall', 'TIA', 'Epilepsie', 'Migräne', 'Multiple Sklerose'],
    ['Aspirin', 'Clopidogrel', 'Heparin', 'Marcumar', 'Alteplase'],
    ['CT', 'MRT', 'EEG', 'EMG', 'Lumbalpunktion'],
    ['Parkinson', 'Alzheimer', 'Huntington', 'ALS', 'Myasthenia gravis'],
    ['Levodopa', 'Dopaminagonist', 'MAO-B-Hemmer', 'COMT-Hemmer', 'Amantadin'],
    ['Meningitis', 'Enzephalitis', 'Hirnabszess', 'Subarachnoidalblutung', 'Subduralhämatom'],
  ],
  'Psychiatrie': [
    ['Depression', 'Manie', 'Schizophrenie', 'Angststörung', 'Borderline-Störung'],
    ['SSRI', 'SNRI', 'Lithium', 'Quetiapin', 'Risperidon'],
    ['Haloperidol', 'Clozapin', 'Olanzapin', 'Aripiprazol', 'Ziprasidon'],
    ['Kognitive Verhaltenstherapie', 'Psychoanalyse', 'EMDR', 'DBT', 'Schematherapie'],
    ['Demenz', 'Delir', 'Amnesie', 'Aphasie', 'Apraxie'],
  ],
  'Frauenheilkunde/Gynäkologie': [
    ['Mammakarzinom', 'Zervixkarzinom', 'Endometriumkarzinom', 'Ovarialkarzinom', 'Vulvakarzinom'],
    ['Östrogen', 'Progesteron', 'FSH', 'LH', 'Prolaktin'],
    ['Sectio caesarea', 'Vakuumextraktion', 'Zangengeburt', 'Episiotomie', 'Wendung'],
    ['Endometriose', 'Myom', 'Ovarizyste', 'Adenomyose', 'Salpingitis'],
    ['HCG', 'AFP', 'CA-125', 'CEA', 'CA 19-9'],
  ],
  'Kinder- und Jugendheilkunde': [
    ['Masern', 'Röteln', 'Mumps', 'Varizellen', 'Scharlach'],
    ['Penicillin V', 'Amoxicillin', 'Cephalosporin', 'Azithromycin', 'Cotrimoxazol'],
    ['Asthma bronchiale', 'Krupp', 'Bronchiolitis', 'Pneumonie', 'Pertussis'],
    ['Meningitis', 'Enzephalitis', 'Fieberkrampf', 'Epilepsie', 'Hydrozephalus'],
    ['ADHS', 'Autismus', 'Lernbehinderung', 'Entwicklungsverzögerung', 'Tourette-Syndrom'],
  ],
  'Augenheilkunde': [
    ['Glaukom', 'Katarakt', 'Makuladegeneration', 'Retinopathie', 'Uveitis'],
    ['Konjunktivitis', 'Keratitis', 'Blepharitis', 'Dakryozystitis', 'Iritis'],
    ['Tonometrie', 'Funduskopie', 'Spaltlampe', 'OCT', 'Gesichtsfeldmessung'],
    ['Timolol', 'Latanoprost', 'Pilokarpin', 'Dorzolamid', 'Brimonidin'],
  ],
  'Hals-Nasen-Ohrenheilkunde': [
    ['Tonsillitis', 'Sinusitis', 'Otitis media', 'Laryngitis', 'Rhinitis'],
    ['Tympanoplastik', 'Tonsillektomie', 'Adenotomie', 'Septumplastik', 'FESS'],
    ['Schallempfindungsschwerhörigkeit', 'Schallleitungsschwerhörigkeit', 'Tinnitus', 'Morbus Menière', 'BPLS'],
    ['Audiogramm', 'Tympanogramm', 'OAE', 'BERA', 'Vestibularisprüfung'],
  ],
  'Dermatologie und Venerologie': [
    ['Melanom', 'Basalzellkarzinom', 'Plattenepithelkarzinom', 'Keratoakanthom', 'Aktinische Keratose'],
    ['Psoriasis', 'Ekzem', 'Urtikaria', 'Neurodermitis', 'Rosacea'],
    ['Syphilis', 'Gonorrhö', 'Chlamydien', 'HIV', 'Herpes genitalis'],
    ['Isotretinoin', 'Methotrexat', 'Ciclosporin', 'Biologika', 'Kortikosteroide'],
  ],
  'Notfall- und Intensivmedizin': [
    ['Reanimation', 'Intubation', 'Defibrillation', 'Kardioversion', 'Schrittmacher'],
    ['Sepsis', 'septischer Schock', 'SIRS', 'Multiorganversagen', 'DIC'],
    ['Adrenalin', 'Noradrenalin', 'Dobutamin', 'Vasopressin', 'Dopamin'],
    ['ARDS', 'Lungenödem', 'Pneumothorax', 'Hämatothorax', 'Perikardtamponade'],
    ['GCS', 'SOFA-Score', 'APACHE-II', 'NEWS-Score', 'Revised Trauma Score'],
  ],
};

const DEFAULT_POOL = [
  ['Diagnose A', 'Diagnose B', 'Diagnose C', 'Diagnose D'],
  ['Therapie 1', 'Therapie 2', 'Therapie 3', 'Therapie 4'],
];

/**
 * Generate 3 plausible wrong options for a given correct answer.
 * Uses numeric variation if answer contains numbers, otherwise
 * uses topic-specific medical term pools.
 */
export function generateWrongOptions(
  _question: string,
  answer: string,
  topic: string
): string[] {
  // 1. Try numeric variants if the answer contains meaningful numbers
  if (hasSignificantNumbers(answer)) {
    const variants = [
      numericVariant(answer, 0.5),
      numericVariant(answer, 1.5),
      numericVariant(answer, 2.0),
      numericVariant(answer, 0.25),
    ].filter((v) => v !== answer);
    const unique = [...new Set(variants)];
    if (unique.length >= 3) return unique.slice(0, 3);
  }

  // 2. Try topic-specific pools
  const pools = TOPIC_POOLS[topic] || DEFAULT_POOL;

  // Find a pool that contains terms matching the answer (partial match)
  const answerLower = answer.toLowerCase();
  for (const pool of pools) {
    const matchIdx = pool.findIndex((term) =>
      answerLower.includes(term.toLowerCase()) || term.toLowerCase().includes(answerLower.slice(0, 8))
    );
    if (matchIdx >= 0) {
      const distractors = pool
        .filter((_, i) => i !== matchIdx)
        .filter((t) => !answerLower.includes(t.toLowerCase()))
        .slice(0, 3);
      if (distractors.length >= 3) return distractors;
      if (distractors.length > 0) {
        // Pad from other pools
        const extra = pools
          .filter((p) => p !== pool)
          .flat()
          .filter((t) => !answerLower.includes(t.toLowerCase()) && !distractors.includes(t))
          .slice(0, 3 - distractors.length);
        return [...distractors, ...extra].slice(0, 3);
      }
    }
  }

  // 3. Use first pool from the topic as fallback
  const fallback = pools[0] || DEFAULT_POOL[0];
  return fallback.filter((t) => !answerLower.includes(t.toLowerCase())).slice(0, 3);
}

/**
 * Build a shuffled MCQ options array (1 correct + 3 wrong).
 */
export function buildMCQOptions(answer: string, wrongOptions: string[]): MCQOption[] {
  const options: MCQOption[] = [
    { text: answer, correct: true },
    ...wrongOptions.slice(0, 3).map((text) => ({ text, correct: false })),
  ];
  return shuffle(options);
}
