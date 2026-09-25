import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from importers.visual_guard import quarantine_missing_visual


class VisualGuardTest(unittest.TestCase):
    def test_missing_source_media_is_quarantined(self):
        for stem in ['Für welche Epilepsie ist das abgebildete EEG-Muster typisch?',
                     'Sie sehen folgendes EEG bei einem Patienten.',
                     'Welche Diagnose zeigt die Läsion auf der Abbildung?']:
            with self.subTest(stem=stem):
                row = {'question': stem, 'is_active': True, 'tags': ['original']}
                result = quarantine_missing_visual(row)
                self.assertFalse(result['is_active'])
                self.assertIn('needs_verified_source_media', result['tags'])
                self.assertTrue(row['is_active'])

    def test_textual_eeg_does_not_require_image(self):
        for stem in ['Wie werden Wellen mit einer Frequenz von 8 bis 12 Hz im EEG genannt?',
                     'Welche Veränderung findet man bei einer Herpesenzephalitis im EEG?',
                     'EEG und CCT zeigen temporale Auffälligkeiten.']:
            self.assertTrue(quarantine_missing_visual({'question': stem, 'is_active': True})['is_active'])

    def test_restored_media_permits_publication(self):
        for field, value in [('image_url', 'https://source/image.png'),
                             ('image_urls', ['https://source/image.png'])]:
            self.assertTrue(quarantine_missing_visual({'question': 'Das abgebildete EEG',
                'is_active': True, field: value})['is_active'])

    def test_blanks_and_choice_art_are_not_stem_media(self):
        row = {'question': 'Das abgebildete EEG', 'is_active': True,
               'image_url': ' ', 'image_urls': [None, ''],
               'choices': [{'image_url': 'https://choice.png'}]}
        self.assertFalse(quarantine_missing_visual(row)['is_active'])

    def test_does_not_reactivate_or_duplicate_tags(self):
        row = {'question': 'Normal question', 'is_active': False, 'image_url': 'https://image.png'}
        self.assertFalse(quarantine_missing_visual(row)['is_active'])
        row = {'question': 'Normal question', 'is_active': True, 'tags': ['missing_image']}
        result = quarantine_missing_visual(quarantine_missing_visual(row))
        self.assertFalse(result['is_active'])
        self.assertEqual(result['tags'].count('missing_image'), 1)

if __name__ == '__main__':
    unittest.main()
