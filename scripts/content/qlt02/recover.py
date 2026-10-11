#!/usr/bin/env python3
"""Extract explicitly reviewed PDF objects to lossless WebP, locally only.

Manifest entries supply question_id, source_path, page, image_index. The image
index is pdfimages' zero-based position on that page, including masks. Choosing
it requires a source-page and clinical self-check; never pick the first image
automatically because a page can contain preceding questions' photos.
Requires pdfimages and Pillow. No uploads, overwrites, env or database access.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def recover(entries, output):
    output.mkdir(parents=True, exist_ok=True)
    objects = []
    for entry in entries:
        qid, page, index = entry['question_id'], entry['page'], entry['image_index']
        if not all(isinstance(v, int) and v >= 0 for v in [qid, page, index]) or page == 0:
            raise ValueError('Invalid question id, page or image index')
        source = Path(entry['source_path'])
        with tempfile.TemporaryDirectory(prefix='b09-extract-') as scratch:
            prefix = Path(scratch) / 'image'
            subprocess.run(['pdfimages', '-f', str(page), '-l', str(page), '-png',
                            str(source), str(prefix)], check=True, capture_output=True, timeout=30)
            raw = Path(f'{prefix}-{index:03}.png')
            with Image.open(raw) as original:
                # Preserve decoded pixels. Medical traces are not downsampled.
                image = original.convert('RGB')
                destination = output / f'{qid}-{page}-{index}.webp'
                if destination.exists():
                    raise FileExistsError(f'Refusing to overwrite {destination}')
                image.save(destination, format='WEBP', lossless=True, method=6)
                with Image.open(destination) as converted:
                    if converted.convert('RGB').tobytes() != image.tobytes():
                        raise ValueError('Lossless conversion changed pixels')
                sha = digest(destination)
                objects.append({**entry, 'local_path': str(destination.resolve()),
                                'object_path': f'track-b-b09/{qid}/{sha}.webp',
                                'sha256': sha, 'source_sha256': digest(source),
                                'original_sha256': digest(raw), 'width': image.width,
                                'height': image.height, 'bytes': destination.stat().st_size,
                                'uploaded': False, 'pixel_equality': True})
    return objects


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('object_manifest', type=Path)
    args = parser.parse_args()
    objects = recover(json.loads(args.manifest.read_text()), args.output)
    args.object_manifest.write_text(json.dumps(objects, indent=2) + '\n')
    print(json.dumps({'prepared_objects': len(objects), 'uploaded_objects': 0,
                      'lossless_pixel_equality': all(o['pixel_equality'] for o in objects)}))
